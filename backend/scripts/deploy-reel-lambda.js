#!/usr/bin/env node
/**
 * Deploys the AWS Lambda reel worker (backend/aws/REEL_WORKER_LAMBDA.md, aws/reel-worker/stack.yaml).
 *
 *   node scripts/deploy-reel-lambda.js [--env <file>] [--skip-build] [--max-concurrency 40]
 *
 * 1. builds the zip (scripts/build-reel-lambda.js) unless --skip-build
 * 2. uploads it to s3://bauhly-reel-worker-code-<account>-<region>/reel-worker/<time>.zip
 * 3. publishes the Remotion site for the current bundle (remotion/render-lambda.mjs --deploy-site)
 * 4. creates / updates the CloudFormation stack "bauhly-reel-worker" and prints its outputs
 *
 * Credentials (an AWS user allowed to manage CloudFormation, IAM, Lambda, SQS, S3, Logs, CloudWatch):
 *   DEPLOY_AWS_ACCESS_KEY_ID / DEPLOY_AWS_SECRET_ACCESS_KEY, else the default AWS chain (a profile).
 * App secrets for the worker come from --env (default backend/.env — use the PRODUCTION values):
 *   MONGO_URI OPENAI_API_KEY ANTHROPIC_API_KEY ANTHROPIC_MODEL ELEVENLABS_API_KEY GEMINI_API_KEY
 *   REMOTION_LICENSE_KEY S3_BUCKET_NAME MEDIA_CDN_BASE_URL, + REMOTION_AWS_* for the site upload.
 * Region: REMOTION_AWS_REGION (eu-north-1 — next to the media bucket and the render functions).
 * Nothing secret is printed.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const arg = (name, dflt = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : dflt;
};
const envFile = path.resolve(arg('env', path.join(ROOT, '.env')));
require('dotenv').config({ path: envFile });

const STACK = 'bauhly-reel-worker';
const region = process.env.REMOTION_AWS_REGION || 'eu-north-1';
const creds = process.env.DEPLOY_AWS_ACCESS_KEY_ID && process.env.DEPLOY_AWS_SECRET_ACCESS_KEY
  ? { credentials: { accessKeyId: process.env.DEPLOY_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.DEPLOY_AWS_SECRET_ACCESS_KEY } }
  : {};
const mask = (v) => (v ? `set (${String(v).length} chars)` : 'MISSING');

async function main() {
  const required = ['MONGO_URI', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'S3_BUCKET_NAME'];
  const optional = ['ANTHROPIC_MODEL', 'ELEVENLABS_API_KEY', 'GEMINI_API_KEY', 'REMOTION_LICENSE_KEY', 'MEDIA_CDN_BASE_URL'];
  console.log(`[deploy] env ${path.relative(process.cwd(), envFile)} · region ${region}`);
  for (const k of [...required, ...optional]) console.log(`  ${k}: ${k === 'S3_BUCKET_NAME' || k === 'ANTHROPIC_MODEL' || k === 'MEDIA_CDN_BASE_URL' ? (process.env[k] || '—') : mask(process.env[k])}`);
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`missing in ${envFile}: ${missing.join(', ')}`);

  const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');
  const who = await new STSClient({ region, ...creds }).send(new GetCallerIdentityCommand({}));
  console.log(`[deploy] AWS account ${who.Account} as ${who.Arn.split('/').pop()}`);

  // 1. build
  if (!arg('skip-build')) execFileSync(process.execPath, [path.join(__dirname, 'build-reel-lambda.js')], { stdio: 'inherit', cwd: ROOT });
  const zip = path.join(ROOT, '.lambda-build', 'reel-worker.zip');
  if (!fs.existsSync(zip)) throw new Error('no .lambda-build/reel-worker.zip — run without --skip-build');

  // 2. upload the code
  const { S3Client, HeadBucketCommand, CreateBucketCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
  const s3 = new S3Client({ region, ...creds });
  const codeBucket = `bauhly-reel-worker-code-${who.Account}-${region}`;
  try { await s3.send(new HeadBucketCommand({ Bucket: codeBucket })); } catch {
    await s3.send(new CreateBucketCommand({ Bucket: codeBucket, CreateBucketConfiguration: { LocationConstraint: region } }));
    console.log(`[deploy] created ${codeBucket}`);
  }
  const codeKey = `reel-worker/${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
  await s3.send(new PutObjectCommand({ Bucket: codeBucket, Key: codeKey, Body: fs.readFileSync(zip) }));
  console.log(`[deploy] uploaded s3://${codeBucket}/${codeKey}`);

  // 3. the Remotion site for the current compositions + the render function's name
  const remotionDir = path.join(ROOT, 'remotion');
  const serveUrl = execFileSync(process.execPath, ['render-lambda.mjs', '--deploy-site'], { cwd: remotionDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim().split('\n').pop();
  const fn = execFileSync(process.execPath, ['--input-type=module', '-e',
    `import { getFunctions } from '@remotion/lambda-client';
     const f = await getFunctions({ region: ${JSON.stringify(region)}, compatibleOnly: true });
     console.log(f.sort((a, b) => b.memorySizeInMb - a.memorySizeInMb)[0]?.functionName || '');`],
  { cwd: remotionDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop();
  if (!/^https:\/\//.test(serveUrl) || !fn) throw new Error(`Remotion site/function not found (site "${serveUrl}", function "${fn}")`);
  console.log(`[deploy] Remotion site ${serveUrl.split('/sites/')[1] || serveUrl} · function ${fn}`);

  // 4. the stack
  const cf = require('@aws-sdk/client-cloudformation');
  const cfn = new cf.CloudFormationClient({ region, ...creds });
  const params = {
    CodeBucket: codeBucket,
    CodeKey: codeKey,
    MediaBucketName: process.env.S3_BUCKET_NAME,
    MediaCdnBaseUrl: process.env.MEDIA_CDN_BASE_URL || '',
    RemotionServeUrl: serveUrl,
    RemotionFunctionName: fn,
    FramesPerLambda: String(arg('frames-per-lambda', '100')),
    MaxConcurrency: String(arg('max-concurrency', '40')),
    MongoUri: process.env.MONGO_URI,
    OpenAiApiKey: process.env.OPENAI_API_KEY,
    AnthropicApiKey: process.env.ANTHROPIC_API_KEY,
    AnthropicModel: process.env.ANTHROPIC_MODEL || '',
    ElevenLabsApiKey: process.env.ELEVENLABS_API_KEY || '',
    GeminiApiKey: process.env.GEMINI_API_KEY || '',
    RemotionLicenseKey: process.env.REMOTION_LICENSE_KEY || '',
  };
  const Parameters = Object.entries(params).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue }));
  const TemplateBody = fs.readFileSync(path.join(ROOT, 'aws', 'reel-worker', 'stack.yaml'), 'utf8');
  let exists = true;
  try {
    const cur = await cfn.send(new cf.DescribeStacksCommand({ StackName: STACK }));
    // a first create that failed leaves a stack that can only be deleted
    if (cur.Stacks?.[0]?.StackStatus === 'ROLLBACK_COMPLETE') {
      console.log('[deploy] removing the failed first attempt…');
      await cfn.send(new cf.DeleteStackCommand({ StackName: STACK }));
      await cf.waitUntilStackDeleteComplete({ client: cfn, maxWaitTime: 900 }, { StackName: STACK });
      exists = false;
    }
  } catch (err) {
    if (!/does not exist/.test(err.message || '')) throw err;
    exists = false;
  }
  const input = { StackName: STACK, TemplateBody, Parameters, Capabilities: ['CAPABILITY_NAMED_IAM'] };
  try {
    await cfn.send(exists ? new cf.UpdateStackCommand(input) : new cf.CreateStackCommand(input));
  } catch (err) {
    if (/No updates are to be performed/.test(err.message)) { console.log('[deploy] stack unchanged'); return outputs(cfn); }
    throw err;
  }
  console.log(`[deploy] ${exists ? 'updating' : 'creating'} stack ${STACK}…`);
  const waiter = exists ? cf.waitUntilStackUpdateComplete : cf.waitUntilStackCreateComplete;
  try {
    await waiter({ client: cfn, maxWaitTime: 1200 }, { StackName: STACK });
  } catch (err) {
    const ev = await cfn.send(new cf.DescribeStackEventsCommand({ StackName: STACK }));
    const failed = (ev.StackEvents || []).filter((e) => /FAILED/.test(e.ResourceStatus || '')).slice(0, 5);
    for (const e of failed) console.error(`  ✗ ${e.LogicalResourceId}: ${e.ResourceStatusReason}`);
    throw new Error(`stack ${exists ? 'update' : 'create'} failed`);
  }
  return outputs(cfn);
}

async function outputs(cfn) {
  const { DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');
  const s = await cfn.send(new DescribeStacksCommand({ StackName: STACK }));
  console.log(`[deploy] ${STACK}: ${s.Stacks[0].StackStatus}`);
  for (const o of s.Stacks[0].Outputs || []) console.log(`  ${o.OutputKey}: ${o.OutputValue}`);
}

main().catch((err) => { console.error(`[deploy] failed: ${err.message}`); process.exit(1); });
