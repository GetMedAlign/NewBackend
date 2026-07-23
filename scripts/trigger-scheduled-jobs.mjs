#!/usr/bin/env node
// Railway cron entrypoint. Runs once per invocation and exits.
//
// Railway cron runs a service's start command on a schedule and expects the
// process to exit. This script is that command. It decides which billing jobs
// are due for the current UTC day and POSTs each to the shared-secret
// job-trigger endpoint, then exits 0 (all due jobs ran) or 1 (any failed) so
// Railway marks the run failed and surfaces it.
//
// Schedule this service DAILY (for example `0 8 * * *`, 08:00 UTC). The
// per-job cadence lives here, not in the cron expression:
//   - account-suspension : every day
//   - weekly-summary     : Mondays
//   - invoice-generation : the 1st of the month
//
// Required env vars on the cron service:
//   SCHEDULER_TARGET_URL  the web service base URL, e.g. https://api.medalign.app
//   JOB_TRIGGER_SECRET    the same secret the web service validates (X-Job-Secret)

const baseUrl = process.env.SCHEDULER_TARGET_URL;
const secret = process.env.JOB_TRIGGER_SECRET;

if (!baseUrl || !secret) {
  console.error(
    'Missing required env. Set SCHEDULER_TARGET_URL and JOB_TRIGGER_SECRET on the cron service.',
  );
  process.exit(1);
}

const now = new Date();
const dayOfWeek = now.getUTCDay(); // 0 Sunday, 1 Monday
const dayOfMonth = now.getUTCDate();

const dueJobs = ['account-suspension'];
if (dayOfWeek === 1) dueJobs.push('weekly-summary');
if (dayOfMonth === 1) dueJobs.push('invoice-generation');

console.log(`[${now.toISOString()}] due jobs: ${dueJobs.join(', ')}`);

const trigger = async (jobName) => {
  const url = `${baseUrl.replace(/\/$/, '')}/admin/jobs/run/${jobName}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'X-Job-Secret': secret },
    });
    const bodyText = await res.text();
    if (!res.ok) {
      console.error(`FAILED ${jobName}: HTTP ${res.status} ${bodyText}`);
      return false;
    }
    console.log(`OK ${jobName}: ${bodyText}`);
    return true;
  } catch (err) {
    console.error(`FAILED ${jobName}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
};

const results = await Promise.all(dueJobs.map(trigger));
const allOk = results.every(Boolean);
process.exit(allOk ? 0 : 1);
