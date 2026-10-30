// ornata-keys — macro helper for Ornata Lighting.
// Copyright (C) 2025 André Lindner. GNU General Public License v2.0 or later.
//
// Watches the keyboard for macro shortcuts, records key presses and plays
// macros back as synthetic key events. The app's main process (src/macros.js)
// starts it and talks to it with one JSON object per line:
//
//   stdin  {"cmd":"macros","list":[{id, mods, keys, presses:[{key,at,hold}], repeat:{mode,times}}]}
//          {"cmd":"capture","on":true}     report every key, shortcuts paused
//          {"cmd":"play","id":"…","delay":3000}
//          {"cmd":"stop"}
//          {"cmd":"permissions"}, {"cmd":"requestPermissions"}, {"cmd":"keyNames"}
//   stdout {"event":"ready"}, {"event":"permissions",…}, {"event":"tap","active":…}
//          {"event":"key","key":…,"down":…,"t":…,"mods":[…]}   (while capturing)
//          {"event":"playing","id":…}, {"event":"stopped","id":…,"reason":…}
//          {"event":"keyNames","names":{…}}, {"event":"error","message":…}
//
// Key codes are macOS virtual key codes. `--selftest` checks the shortcut
// matching and the playback timeline without touching the keyboard.
// `--dry-run` (development) never watches the keyboard and only reports the
// keys it would press, {"event":"dry","key":…,"down":…}, so macOS asks for no
// permission.

import ApplicationServices
import Carbon.HIToolbox
import CoreGraphics
import Foundation

// Marks the events this helper posts, so its own tap lets them through.
let SYNTHETIC: Int64 = 0x4F52_4E41 // "ORNA"
// A key that may start a shortcut waits this long for the rest of it.
let CHORD_WAIT_MS = 300
// How often to retry the event tap while the permissions are missing.
let TAP_RETRY_S = 2.0
let DRY_RUN = CommandLine.arguments.contains("--dry-run")
// Playback naps through the last few ms before a key event to hit it on time.
let SPIN_MS = 15

// MARK: - output

let outQueue = DispatchQueue(label: "ornata-keys.out")

func emit(_ obj: [String: Any]) {
  outQueue.async {
    guard var data = try? JSONSerialization.data(withJSONObject: obj) else { return }
    data.append(0x0A)
    FileHandle.standardOutput.write(data)
  }
}

// MARK: - modifiers

// Modifier key code -> (name in shortcuts, device-dependent flag bit).
let MODIFIER_KEYS: [Int: (String, UInt64)] = [
  kVK_Control: ("ctrl", 0x01), kVK_RightControl: ("ctrl", 0x2000),
  kVK_Shift: ("shift", 0x02), kVK_RightShift: ("shift", 0x04),
  kVK_Option: ("alt", 0x20), kVK_RightOption: ("alt", 0x40),
  kVK_Command: ("cmd", 0x08), kVK_RightCommand: ("cmd", 0x10),
]
let MOD_MASKS: [String: CGEventFlags] = [
  "ctrl": .maskControl, "alt": .maskAlternate, "shift": .maskShift, "cmd": .maskCommand,
]
// Caps Lock toggles and Fn never reaches the Mac from the Ornata; neither
// takes part in shortcuts or recordings.
let IGNORED_KEYS: Set<Int> = [kVK_CapsLock, kVK_Function]

func modNames(_ flags: CGEventFlags) -> Set<String> {
  Set(MOD_MASKS.filter { flags.contains($0.value) }.map { $0.key })
}

// MARK: - macros

struct Press {
  let key: Int
  let at: Int   // ms from the start of the macro
  let hold: Int // ms
}

struct Macro {
  let id: String
  let mods: Set<String>
  let keys: Set<Int>
  let presses: [Press]
  let mode: String // "once" | "times" | "loop"
  let times: Int

  init?(_ obj: [String: Any]) {
    guard let id = obj["id"] as? String else { return nil }
    self.id = id
    mods = Set((obj["mods"] as? [String] ?? []).filter { MOD_MASKS[$0] != nil })
    keys = Set((obj["keys"] as? [Int] ?? []).filter { MODIFIER_KEYS[$0] == nil })
    presses = (obj["presses"] as? [[String: Any]] ?? []).compactMap { p in
      guard let key = p["key"] as? Int, let at = p["at"] as? Int, let hold = p["hold"] as? Int else { return nil }
      return Press(key: key, at: max(0, at), hold: max(1, hold))
    }
    let repeatObj = obj["repeat"] as? [String: Any] ?? [:]
    mode = repeatObj["mode"] as? String ?? "once"
    times = max(1, repeatObj["times"] as? Int ?? 1)
  }

  init(id: String, mods: Set<String>, keys: Set<Int>, presses: [Press] = [], mode: String = "once", times: Int = 1) {
    self.id = id; self.mods = mods; self.keys = keys; self.presses = presses; self.mode = mode; self.times = times
  }
}

// One key going down or up, `t` ms into a round of the macro.
struct Step {
  let t: Int
  let key: Int
  let down: Bool
}

// The presses as a time-ordered list of key events. At the same moment a key
// is released before another goes down.
func timeline(_ presses: [Press]) -> [Step] {
  var steps: [(Step, Int)] = []
  for (i, p) in presses.enumerated() {
    steps.append((Step(t: p.at, key: p.key, down: true), i * 2))
    steps.append((Step(t: p.at + p.hold, key: p.key, down: false), i * 2 + 1))
  }
  steps.sort { a, b in
    if a.0.t != b.0.t { return a.0.t < b.0.t }
    if a.0.down != b.0.down { return !a.0.down }
    return a.1 < b.1
  }
  return steps.map { $0.0 }
}

// MARK: - shortcut matching

// Decides for every physical key-down whether it completes a shortcut, may be
// the start of one, or has nothing to do with them. Keys that are already held
// (walking with W, say) don't get in the way.
final class ShortcutMatcher {
  enum Verdict { case pass, wait, match(Macro) }

  var macros: [Macro] = []
  private(set) var held = Set<Int>()

  func keyDown(_ key: Int, mods: Set<String>) -> Verdict {
    held.insert(key)
    var startsOne = false
    for m in macros where !m.keys.isEmpty && m.mods == mods && m.keys.contains(key) {
      if m.keys.isSubset(of: held) { return .match(m) }
      startsOne = true
    }
    return startsOne ? .wait : .pass
  }

  func keyUp(_ key: Int) { held.remove(key) }
}

// MARK: - playback

final class Player {
  private let lock = NSLock()
  private var cancel: DispatchSemaphore?
  private var finished: DispatchSemaphore?
  private var current: String?
  private let source = CGEventSource(stateID: .privateState)

  var playingId: String? {
    lock.lock(); defer { lock.unlock() }
    return current
  }

  func play(_ macro: Macro, delayMs: Int = 0) {
    stop(wait: true)
    let cancel = DispatchSemaphore(value: 0)
    let finished = DispatchSemaphore(value: 0)
    lock.lock()
    self.cancel = cancel; self.finished = finished; current = macro.id
    lock.unlock()
    let thread = Thread { self.run(macro, delayMs, cancel, finished) }
    thread.qualityOfService = .userInteractive
    thread.start()
  }

  // wait: block until the keys are released, so a following macro starts clean.
  func stop(wait: Bool = false) {
    lock.lock()
    let cancel = self.cancel, finished = self.finished
    lock.unlock()
    cancel?.signal()
    if wait, let finished = finished {
      if finished.wait(timeout: .now() + .milliseconds(500)) == .success { finished.signal() }
    }
  }

  private func run(_ macro: Macro, _ delayMs: Int, _ cancel: DispatchSemaphore, _ finished: DispatchSemaphore) {
    emit(["event": "playing", "id": macro.id])
    let steps = timeline(macro.presses)
    var downKeys = Set<Int>()
    var canceled = delayMs > 0 && cancel.wait(timeout: .now() + .milliseconds(delayMs)) == .success
    var round = 0
    rounds: while !canceled && !steps.isEmpty {
      let start = DispatchTime.now()
      for step in steps {
        if !waitUntil(start + .milliseconds(step.t), cancel) {
          canceled = true
          break rounds
        }
        post(step.key, step.down, &downKeys)
      }
      round += 1
      if macro.mode == "once" || (macro.mode == "times" && round >= macro.times) { break }
    }
    for key in downKeys { post(key, false, &downKeys) }

    lock.lock()
    if self.cancel === cancel { self.cancel = nil; self.finished = nil; current = nil }
    lock.unlock()
    emit(["event": "stopped", "id": macro.id, "reason": canceled ? "canceled" : "done"])
    finished.signal()
  }

  // Sleep until `due`, false when canceled. A timed wait can wake several ms
  // late, so it stops short and the last moments are spent in short naps.
  private func waitUntil(_ due: DispatchTime, _ cancel: DispatchSemaphore) -> Bool {
    let early = due - .milliseconds(SPIN_MS)
    if early > DispatchTime.now(), cancel.wait(timeout: early) == .success { return false }
    while DispatchTime.now() < due { usleep(100) }
    return true
  }

  private func post(_ key: Int, _ down: Bool, _ downKeys: inout Set<Int>) {
    if DRY_RUN {
      if down { downKeys.insert(key) } else { downKeys.remove(key) }
      emit(["event": "dry", "key": key, "down": down, "t": Double(DispatchTime.now().uptimeNanoseconds) / 1_000_000])
      return
    }
    guard let event = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(key), keyDown: down) else { return }
    if down { downKeys.insert(key) } else { downKeys.remove(key) }
    var flags: CGEventFlags = []
    for k in downKeys {
      guard let (name, bit) = MODIFIER_KEYS[k], let mask = MOD_MASKS[name] else { continue }
      flags.insert(mask)
      flags.insert(CGEventFlags(rawValue: bit))
    }
    if MODIFIER_KEYS[key] != nil { event.type = .flagsChanged }
    event.flags = flags
    event.setIntegerValueField(.eventSourceUserData, value: SYNTHETIC)
    event.post(tap: .cghidEventTap)
  }
}

// MARK: - the helper

final class Helper {
  static let shared = Helper()

  let matcher = ShortcutMatcher()
  let player = Player()
  var capturing = false
  var tap: CFMachPort?
  var tapSource: CFRunLoopSource?
  var retryScheduled = false

  // Key-downs held back while they may start a shortcut, oldest first.
  var waiting: [(key: Int, event: CGEvent)] = []
  var waitGeneration = 0
  // Keys of a recognized shortcut: their key-up (and key repeat) is swallowed.
  var swallowed = Set<Int>()
  // A shortcut that was pressed; its macro starts once all its keys are up.
  var armed: Macro?

  var tapWanted: Bool { capturing || !matcher.macros.isEmpty }

  // MARK: commands

  func handle(_ msg: [String: Any]) {
    switch msg["cmd"] as? String {
    case "macros":
      matcher.macros = (msg["list"] as? [[String: Any]] ?? []).compactMap(Macro.init)
      if let playing = player.playingId, !matcher.macros.contains(where: { $0.id == playing }) { player.stop() }
      updateTap()
    case "capture":
      capturing = msg["on"] as? Bool ?? false
      flushWaiting()
      armed = nil
      updateTap()
    case "play":
      guard let id = msg["id"] as? String, let macro = Macro(msg["macro"] as? [String: Any] ?? [:])
        ?? matcher.macros.first(where: { $0.id == id }) else {
        emit(["event": "error", "message": "Unknown macro"])
        return
      }
      player.play(macro, delayMs: msg["delay"] as? Int ?? 0)
    case "stop":
      player.stop()
    case "permissions":
      emitPermissions()
    case "requestPermissions" where DRY_RUN:
      emitPermissions()
    case "requestPermissions":
      CGRequestListenEventAccess()
      CGRequestPostEventAccess()
      let prompt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
      _ = AXIsProcessTrustedWithOptions([prompt: true] as CFDictionary)
      emitPermissions()
      updateTap()
    case "keyNames":
      emit(["event": "keyNames", "names": keyNames()])
    default:
      emit(["event": "error", "message": "Unknown command"])
    }
  }

  func emitPermissions() {
    if DRY_RUN {
      emit(["event": "permissions", "inputMonitoring": false, "accessibility": false])
      return
    }
    emit([
      "event": "permissions",
      "inputMonitoring": CGPreflightListenEventAccess(),
      "accessibility": AXIsProcessTrusted(),
    ])
  }

  // MARK: event tap

  func updateTap() {
    if tapWanted && tap == nil {
      createTap()
    } else if !tapWanted && tap != nil {
      removeTap()
    }
  }

  func createTap() {
    if DRY_RUN { return }
    let mask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue)
      | (1 << CGEventType.flagsChanged.rawValue)
    guard let port = CGEvent.tapCreate(
      tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
      eventsOfInterest: CGEventMask(mask), callback: tapCallback, userInfo: nil)
    else {
      emit(["event": "tap", "active": false])
      emitPermissions()
      scheduleTapRetry()
      return
    }
    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, port, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    CGEvent.tapEnable(tap: port, enable: true)
    tap = port
    tapSource = source
    emit(["event": "tap", "active": true])
    emitPermissions()
  }

  func removeTap() {
    flushWaiting()
    if let port = tap { CGEvent.tapEnable(tap: port, enable: false); CFMachPortInvalidate(port) }
    if let source = tapSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
    tap = nil
    tapSource = nil
    swallowed.removeAll()
    armed = nil
    emit(["event": "tap", "active": false])
  }

  func scheduleTapRetry() {
    guard !retryScheduled else { return }
    retryScheduled = true
    DispatchQueue.main.asyncAfter(deadline: .now() + TAP_RETRY_S) {
      self.retryScheduled = false
      self.updateTap()
    }
  }

  // MARK: key events

  func handleTap(_ type: CGEventType, _ event: CGEvent) -> Unmanaged<CGEvent>? {
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
      if let port = tap { CGEvent.tapEnable(tap: port, enable: true) }
      return Unmanaged.passUnretained(event)
    }
    if event.getIntegerValueField(.eventSourceUserData) == SYNTHETIC { return Unmanaged.passUnretained(event) }

    let key = Int(event.getIntegerValueField(.keyboardEventKeycode))
    if IGNORED_KEYS.contains(key) { return Unmanaged.passUnretained(event) }
    let isRepeat = event.getIntegerValueField(.keyboardEventAutorepeat) != 0
    let down: Bool
    switch type {
    case .keyDown: down = true
    case .keyUp: down = false
    case .flagsChanged:
      guard let (_, bit) = MODIFIER_KEYS[key] else { return Unmanaged.passUnretained(event) }
      down = event.flags.rawValue & bit != 0
    default: return Unmanaged.passUnretained(event)
    }

    if capturing {
      if !isRepeat {
        let ms = Double(DispatchTime.now().uptimeNanoseconds) / 1_000_000
        emit(["event": "key", "key": key, "down": down, "t": ms, "mods": Array(modNames(event.flags)).sorted()])
      }
      return Unmanaged.passUnretained(event)
    }

    if type == .flagsChanged {
      flushWaiting()
      startArmedIfReleased(event.flags)
      return Unmanaged.passUnretained(event)
    }

    if !down {
      matcher.keyUp(key)
      if waiting.contains(where: { $0.key == key }) {
        flushWaiting(then: event)
        return nil
      }
      let wasSwallowed = swallowed.remove(key) != nil
      startArmedIfReleased(event.flags)
      return wasSwallowed ? nil : Unmanaged.passUnretained(event)
    }

    if isRepeat {
      return swallowed.contains(key) || waiting.contains(where: { $0.key == key }) ? nil : Unmanaged.passUnretained(event)
    }

    switch matcher.keyDown(key, mods: modNames(event.flags)) {
    case .match(let macro):
      // The waiting keys of this shortcut are swallowed, others go out first.
      let others = waiting.filter { !macro.keys.contains($0.key) }
      waiting.removeAll()
      repost(others.map { $0.event })
      swallowed.formUnion(macro.keys)
      if player.playingId == macro.id {
        player.stop()
        armed = nil
      } else {
        armed = macro
      }
      return nil
    case .wait:
      if let copy = event.copy() {
        waiting.append((key, copy))
        waitGeneration += 1
        let generation = waitGeneration
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(CHORD_WAIT_MS)) {
          if self.waitGeneration == generation { self.flushWaiting() }
        }
        return nil
      }
      return Unmanaged.passUnretained(event)
    case .pass:
      if waiting.isEmpty { return Unmanaged.passUnretained(event) }
      flushWaiting(then: event)
      return nil
    }
  }

  // The macro of a pressed shortcut starts when its keys and modifiers are
  // up, so they don't mix with the keys the macro presses.
  func startArmedIfReleased(_ flags: CGEventFlags) {
    guard let macro = armed, macro.keys.isDisjoint(with: matcher.held),
      macro.mods.isDisjoint(with: modNames(flags)) else { return }
    armed = nil
    // Not from inside the tap callback: play() may wait for a previous macro.
    DispatchQueue.main.async { self.player.play(macro) }
  }

  // Send the held-back key-downs after all, in order, then `then`.
  func flushWaiting(then event: CGEvent? = nil) {
    var events = waiting.map { $0.event }
    waiting.removeAll()
    waitGeneration += 1
    if let event = event, let copy = event.copy() { events.append(copy) }
    repost(events)
  }

  func repost(_ events: [CGEvent]) {
    for e in events {
      e.setIntegerValueField(.eventSourceUserData, value: SYNTHETIC)
      e.post(tap: .cghidEventTap)
    }
  }
}

let tapCallback: CGEventTapCallBack = { _, type, event, _ in
  Helper.shared.handleTap(type, event)
}

// MARK: - key names

// Names for keys whose cap the layout can't tell (the Ornata's PC keys as macOS
// sees them: Print = F13, Scroll Lock = F14, Pause = F15, Insert = Help).
let FIXED_NAMES: [Int: String] = [
  kVK_Return: "Return", kVK_Tab: "Tab", kVK_Space: "Space", kVK_Delete: "Backspace", kVK_Escape: "Esc",
  kVK_ForwardDelete: "Delete", kVK_Home: "Home", kVK_End: "End", kVK_PageUp: "Page Up", kVK_PageDown: "Page Down",
  kVK_Help: "Insert", kVK_LeftArrow: "←", kVK_RightArrow: "→", kVK_DownArrow: "↓", kVK_UpArrow: "↑",
  kVK_F1: "F1", kVK_F2: "F2", kVK_F3: "F3", kVK_F4: "F4", kVK_F5: "F5", kVK_F6: "F6", kVK_F7: "F7", kVK_F8: "F8",
  kVK_F9: "F9", kVK_F10: "F10", kVK_F11: "F11", kVK_F12: "F12", kVK_F13: "Print", kVK_F14: "Scroll Lock",
  kVK_F15: "Pause", kVK_F16: "F16", kVK_F17: "F17", kVK_F18: "F18", kVK_F19: "F19", kVK_F20: "F20",
  kVK_ANSI_KeypadEnter: "Num Enter", kVK_ANSI_KeypadClear: "Num Lock", kVK_ANSI_KeypadDecimal: "Num ,",
  kVK_ANSI_KeypadMultiply: "Num *", kVK_ANSI_KeypadPlus: "Num +", kVK_ANSI_KeypadDivide: "Num /",
  kVK_ANSI_KeypadMinus: "Num -", kVK_ANSI_KeypadEquals: "Num =",
  kVK_ANSI_Keypad0: "Num 0", kVK_ANSI_Keypad1: "Num 1", kVK_ANSI_Keypad2: "Num 2", kVK_ANSI_Keypad3: "Num 3",
  kVK_ANSI_Keypad4: "Num 4", kVK_ANSI_Keypad5: "Num 5", kVK_ANSI_Keypad6: "Num 6", kVK_ANSI_Keypad7: "Num 7",
  kVK_ANSI_Keypad8: "Num 8", kVK_ANSI_Keypad9: "Num 9",
  kVK_Control: "Ctrl", kVK_RightControl: "Right Ctrl", kVK_Shift: "Shift", kVK_RightShift: "Right Shift",
  kVK_Option: "Alt", kVK_RightOption: "Alt Gr", kVK_Command: "Cmd", kVK_RightCommand: "Right Cmd",
  kVK_CapsLock: "Caps Lock", kVK_Function: "Fn", 110: "Menu",
]

// Key code -> what its cap shows: the fixed names plus the characters of the
// current keyboard layout (so a German layout shows Z, Ö, ß …).
func keyNames() -> [String: String] {
  var names: [String: String] = [:]
  for (code, name) in FIXED_NAMES { names[String(code)] = name }
  guard let source = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
    let ptr = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData)
  else { return names }
  let data = Unmanaged<CFData>.fromOpaque(ptr).takeUnretainedValue() as Data
  data.withUnsafeBytes { raw in
    guard let layout = raw.bindMemory(to: UCKeyboardLayout.self).baseAddress else { return }
    for code in 0..<128 where FIXED_NAMES[code] == nil {
      var dead: UInt32 = 0
      var length = 0
      var chars = [UniChar](repeating: 0, count: 4)
      let status = UCKeyTranslate(
        layout, UInt16(code), UInt16(kUCKeyActionDisplay), 0, UInt32(LMGetKbdType()),
        OptionBits(kUCKeyTranslateNoDeadKeysBit), &dead, chars.count, &length, &chars)
      guard status == noErr, length > 0 else { continue }
      let text = String(utf16CodeUnits: chars, count: length).trimmingCharacters(in: .whitespacesAndNewlines)
      if !text.isEmpty, !text.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) {
        let upper = text.uppercased() // but ß stays ß, not SS
        names[String(code)] = upper.count == text.count ? upper : text
      }
    }
  }
  return names
}

// MARK: - self test

func selftest() -> Bool {
  var ok = true
  func check(_ cond: Bool, _ what: String) {
    if !cond { ok = false; print("FAIL", what) }
  }
  let f = kVK_ANSI_F, g = kVK_ANSI_G, w = kVK_ANSI_W
  let m = ShortcutMatcher()
  m.macros = [Macro(id: "fg", mods: ["ctrl"], keys: [f, g])]
  if case .wait = m.keyDown(f, mods: ["ctrl"]) {} else { check(false, "ctrl+f waits for g") }
  if case .match(let hit) = m.keyDown(g, mods: ["ctrl"]) { check(hit.id == "fg", "match id") } else { check(false, "ctrl+f+g matches") }
  m.keyUp(f); m.keyUp(g)
  if case .pass = m.keyDown(f, mods: []) {} else { check(false, "f without ctrl passes") }
  m.keyUp(f)
  _ = m.keyDown(w, mods: [])
  _ = m.keyDown(f, mods: ["ctrl"])
  if case .match = m.keyDown(g, mods: ["ctrl"]) {} else { check(false, "match while W is held") }

  let steps = timeline([
    Press(key: 126, at: 0, hold: 2000), Press(key: 123, at: 2000, hold: 200), Press(key: 126, at: 2200, hold: 10000),
  ])
  let expected = [(0, 126, true), (2000, 126, false), (2000, 123, true), (2200, 123, false), (2200, 126, true), (12200, 126, false)]
  check(steps.count == expected.count, "timeline length")
  for (s, e) in zip(steps, expected) {
    check(s.t == e.0 && s.key == e.1 && s.down == e.2, "timeline step \(e)")
  }
  print(ok ? "selftest ok" : "selftest failed")
  return ok
}

// MARK: - main

let args = CommandLine.arguments.dropFirst()
if args.contains("--selftest") { exit(selftest() ? 0 : 1) }
if args.contains("--key-names") {
  let names = keyNames()
  let data = try! JSONSerialization.data(withJSONObject: names, options: [.sortedKeys])
  print(String(data: data, encoding: .utf8)!)
  exit(0)
}

signal(SIGPIPE, SIG_IGN)
Thread.detachNewThread {
  while let line = readLine() {
    guard let data = line.data(using: .utf8),
      let msg = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { continue }
    DispatchQueue.main.async { Helper.shared.handle(msg) }
  }
  // The app went away: let go of every key and quit.
  DispatchQueue.main.async {
    Helper.shared.player.stop(wait: true)
    outQueue.sync {}
    exit(0)
  }
}
emit(["event": "ready"])
CFRunLoopRun()
