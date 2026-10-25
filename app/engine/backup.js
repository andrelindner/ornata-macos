'use strict';

// ornata-macos — backing up profiles and settings to a folder, and restoring.
//
// Copyright (C) 2025 André Lindner
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU General Public License as published by the Free
// Software Foundation, either version 2 of the License, or (at your option)
// any later version. Distributed WITHOUT ANY WARRANTY; see the GNU General
// Public License for more details.
//
// Plain Node (no Electron), so the folder logic stays independent of where the
// folder lives: a local disk, a network share, or an iCloud Drive folder.
//
// Layout of a backup folder:
//
//   <folder>/
//     ornata-backup.json   manifest: when, from which Mac, app version,
//                          profile list, settings
//     profiles/*.json      one file per profile, same format as the app's
//     deleted/*.json       profiles deleted locally, kept for a grace period
//
// Plain files instead of an archive: the folder can be opened in Finder and a
// single profile can be taken out by hand, even without this app.
//
// Up to v1.3.x the backup was a flat copy of the profile files in <folder>.
// inspect() and restore() still read that format, also next to a manifest —
// backup() never touches those files, so they can't age out of the folder.

const fs = require('fs');
const os = require('os');
const path = require('path');
const scenes = require('./scenes.js');

const MANIFEST = 'ornata-backup.json';
const FORMAT_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

class BackupError extends Error {}

// Profile files of the old flat format in the top level of dir.
function legacyFiles(dir) {
  return scenes.listScenes(dir).filter((f) => f !== MANIFEST);
}

function readManifest(dir) {
  const file = path.join(dir, MANIFEST);
  if (!fs.existsSync(file)) return null;
  let m;
  try {
    m = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new BackupError(`The backup manifest is unreadable: ${e.message}`);
  }
  if (Number(m.formatVersion) > FORMAT_VERSION) {
    throw new BackupError(`The backup was created by a newer version of the app (format ${m.formatVersion}). Please update the app.`);
  }
  return {
    formatVersion: Number(m.formatVersion) || FORMAT_VERSION,
    createdAt: m.createdAt || null,
    createdOnHost: m.createdOnHost || '',
    appVersion: m.appVersion || '',
    profiles: Array.isArray(m.profiles) ? m.profiles : [],
    removedProfiles: Array.isArray(m.removedProfiles) ? m.removedProfiles : [],
    settings: m.settings && typeof m.settings === 'object' ? m.settings : null,
  };
}

// The backup folder for a folder the user picked: when that is the profiles/
// or deleted/ subfolder of a backup, the backup itself is its parent.
function backupRoot(dir) {
  const parent = path.dirname(dir);
  const sub = path.basename(dir);
  if ((sub === 'profiles' || sub === 'deleted')
      && !fs.existsSync(path.join(dir, MANIFEST))
      && fs.existsSync(path.join(parent, MANIFEST))) return parent;
  return dir;
}

// Write via a temp file + rename, so an interrupted backup never leaves a
// half-written manifest behind.
function writeJsonAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function ensureWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
  } catch (_) {
    throw new BackupError(`Cannot write to ${dir}. For a network drive: is it mounted and writable?`);
  }
}

function sameContent(a, b) {
  try { return fs.readFileSync(a).equals(fs.readFileSync(b)); } catch (_) { return false; }
}

// Back up every profile in profilesDir plus the given settings into dir.
//
// A profile that disappeared locally is not dropped from the backup at once:
// it moves to deleted/ and stays there for retentionDays (0 = forever). An
// accidental delete is often noticed days later; until then the copy is still
// there. If the profile shows up locally again, it simply comes back.
function backup(dir, { profilesDir, settings, appVersion, retentionDays }) {
  if (!dir) throw new BackupError('No backup folder is configured.');
  ensureWritable(dir);
  const outDir = path.join(dir, 'profiles');
  const delDir = path.join(dir, 'deleted');
  fs.mkdirSync(outDir, { recursive: true });

  let prev = null;
  try { prev = readManifest(dir); } catch (_) { /* rebuilt below */ }
  const now = new Date();
  const local = scenes.listScenes(profilesDir);
  const report = { saved: [], retired: [], purged: [], revived: [] };

  const profiles = [];
  for (const f of local) {
    const src = path.join(profilesDir, f);
    fs.copyFileSync(src, path.join(outDir, f));
    profiles.push({ name: f, modifiedAt: fs.statSync(src).mtime.toISOString() });
    report.saved.push(f);
  }

  const removed = new Map();
  for (const r of (prev && prev.removedProfiles) || []) {
    if (r && r.name) removed.set(path.basename(r.name), r.removedAt || now.toISOString());
  }

  // Back locally: drop the grace-period copy.
  for (const name of [...removed.keys()]) {
    if (local.includes(name)) {
      fs.rmSync(path.join(delDir, name), { force: true });
      removed.delete(name);
      report.revived.push(name);
    }
  }

  // Gone locally: move into the grace period.
  for (const f of scenes.listScenes(outDir)) {
    if (local.includes(f)) continue;
    fs.mkdirSync(delDir, { recursive: true });
    fs.renameSync(path.join(outDir, f), path.join(delDir, f));
    removed.set(f, now.toISOString());
    report.retired.push(f);
  }

  // Grace period over: remove for good.
  if (retentionDays > 0) {
    for (const [name, at] of [...removed.entries()]) {
      if (now - new Date(at) > retentionDays * DAY_MS) {
        fs.rmSync(path.join(delDir, name), { force: true });
        removed.delete(name);
        report.purged.push(name);
      }
    }
  }

  writeJsonAtomic(path.join(dir, MANIFEST), {
    formatVersion: FORMAT_VERSION,
    createdAt: now.toISOString(),
    createdOnHost: os.hostname(),
    appVersion,
    profiles,
    removedProfiles: [...removed.entries()].map(([name, removedAt]) => ({ name, removedAt })),
    settings,
  });
  return report;
}

// Describe what a backup folder contains, without changing anything.
function inspect(dir, profilesDir) {
  if (!fs.existsSync(dir)) throw new BackupError(`The folder ${dir} is not reachable.`);
  const manifest = readManifest(dir);
  const local = new Set(scenes.listScenes(profilesDir));
  if (manifest) {
    const inBackup = new Set(scenes.listScenes(path.join(dir, 'profiles')));
    const inDeleted = new Set(scenes.listScenes(path.join(dir, 'deleted')));
    const older = legacyFiles(dir).filter((n) => !inBackup.has(n));
    return {
      legacy: false,
      createdAt: manifest.createdAt,
      createdOnHost: manifest.createdOnHost,
      appVersion: manifest.appVersion,
      hasSettings: !!manifest.settings,
      profiles: manifest.profiles
        .map((p) => path.basename(p.name || ''))
        .filter((n) => inBackup.has(n))
        .map((name) => ({ name, existsLocally: local.has(name) }))
        .concat(older.map((name) => ({ name, existsLocally: local.has(name), olderBackup: true }))),
      removedProfiles: manifest.removedProfiles
        .filter((r) => r && inDeleted.has(path.basename(r.name || '')))
        .map((r) => ({ name: path.basename(r.name), removedAt: r.removedAt, existsLocally: local.has(path.basename(r.name)) })),
    };
  }
  const flat = legacyFiles(dir);
  if (!flat.length) {
    throw new BackupError(`There is no backup in ${dir}. Expected the file “${MANIFEST}” or profile .json files.`);
  }
  return {
    legacy: true,
    createdAt: null,
    createdOnHost: '',
    appVersion: '',
    hasSettings: false,
    profiles: flat.map((name) => ({ name, existsLocally: local.has(name) })),
    removedProfiles: [],
  };
}

// Restore profiles (and optionally settings) from dir into profilesDir.
// Existing local profiles are only replaced with overwrite: true. revive lists
// grace-period profiles (deleted/) to bring back as well.
// Returns { restored, revived, kept, failed, settings } — settings is the
// backed-up settings object when restoreSettings is set, otherwise null.
function restore(dir, { profilesDir, overwrite = false, restoreSettings = false, revive = [] }) {
  const manifest = readManifest(dir);
  const srcDir = manifest ? path.join(dir, 'profiles') : dir;
  const result = { restored: [], revived: [], kept: [], failed: [], settings: null };
  fs.mkdirSync(profilesDir, { recursive: true });

  const copyIn = (src, name, bucket) => {
    const dest = path.join(profilesDir, name);
    if (fs.existsSync(dest) && !overwrite) {
      if (!sameContent(src, dest)) result.kept.push(name);
      return;
    }
    try {
      scenes.readScene(src); // only copy files that are valid profiles
      fs.copyFileSync(src, dest);
      bucket.push(name);
    } catch (e) {
      result.failed.push({ name, reason: e.message });
    }
  };

  for (const name of legacyFiles(srcDir)) copyIn(path.join(srcDir, name), name, result.restored);
  if (manifest) {
    for (const name of legacyFiles(dir)) {
      if (!fs.existsSync(path.join(srcDir, name))) copyIn(path.join(dir, name), name, result.restored);
    }
    for (const raw of revive) {
      const name = path.basename(String(raw));
      const src = path.join(dir, 'deleted', name);
      if (fs.existsSync(src)) copyIn(src, name, result.revived);
    }
    if (restoreSettings) result.settings = manifest.settings;
  }
  return result;
}

module.exports = { BackupError, MANIFEST, backup, backupRoot, inspect, restore };
