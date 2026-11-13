/*
 * How much memory this process's container may use, in MB.
 *
 * Inside a container (Render, Docker) os.totalmem() reports the HOST's memory,
 * not the limit the container is killed at — so read the cgroup limit
 * (v2: /sys/fs/cgroup/memory.max, v1: memory.limit_in_bytes). Off Linux, or
 * with no limit set, the machine's total memory is the answer.
 */
const fs = require('fs');
const os = require('os');

function readNumber(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw || raw === 'max') return null;
    const n = Number(raw);
    // v1 reports a huge sentinel when unlimited
    return Number.isFinite(n) && n > 0 && n < 2 ** 60 ? n : null;
  } catch {
    return null;
  }
}

function memoryLimitMb() {
  const bytes = readNumber('/sys/fs/cgroup/memory.max')
    ?? readNumber('/sys/fs/cgroup/memory/memory.limit_in_bytes');
  const total = os.totalmem();
  return Math.round(Math.min(bytes || total, total) / (1024 * 1024));
}

module.exports = { memoryLimitMb };
