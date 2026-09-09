/**
 * Migrate cover images from Supabase Storage to Cloudinary.
 *
 * Reads all Story rows whose coverImage is a *.supabase.co URL, downloads each
 * file (signed/unsigned as configured), uploads to Cloudinary (folder: vstory/covers,
 * public_id: <storyId>), and writes the new secure_url back to Story.coverImage.
 *
 * SAFETY:
 *  - Creates a backup row QR (Story_BACKUP_*) in a JSON file before any change.
 *  - Per-story: if Cloudinary upload fails, that story is skipped (not blocked).
 *  - Idempotent: re-running won't re-migrate rows that already point to cloudinary.com.
 *  - DRY-RUN default (--apply to commit).
 *
 * Env:
 *   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 *   DATABASE_URL
 *
 * Usage:
 *   npx tsx scripts/migrate-supabase-to-cloudinary.ts           # dry-run
 *   npx tsx scripts/migrate-supabase-to-cloudinary.ts --apply   # commit
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const CLOUD_NAME  = process.env.CLOUDINARY_CLOUD_NAME  || '';
const API_KEY     = process.env.CLOUDINARY_API_KEY     || '';
const API_SECRET  = process.env.CLOUDINARY_API_SECRET  || '';
const FOLDER      = 'vstory/covers';

if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
  console.error('Missing Cloudinary env vars. Abort.');
  process.exit(1);
}

function buildSignature(params: Record<string, string | number>): string {
  const sorted = Object.keys(params).sort()
    .map(k => `${k}=${params[k]}`).join('&');
  return crypto.createHash('sha1').update(sorted + API_SECRET).digest('hex');
}

async function fetchSupabaseBuffer(url: string): Promise<{ ok: boolean; buf?: Buffer; contentType?: string; error?: string }> {
  try {
    const r = await fetch(url);
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const ab = await r.arrayBuffer();
    return { ok: true, buf: Buffer.from(ab), contentType: r.headers.get('content-type') || 'image/webp' };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function uploadToCloudinary(buf: Buffer, publicId: string): Promise<string | null> {
  const timestamp = Math.floor(Date.now() / 1000);
  const params: Record<string, string|number> = {
    folder: FOLDER,
    public_id: publicId,
    timestamp,
    overwrite: 1,
    invalidate: 1,
  };
  const signature = buildSignature(params);

  const form = new FormData();
  form.append('file', new Blob([buf]), `${publicId}.bin`);
  form.append('api_key', API_KEY);
  for (const [k, v] of Object.entries(params)) form.append(k, String(v));
  form.append('signature', signature);

  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;
  const r = await fetch(url, { method: 'POST', body: form });
  if (!r.ok) {
    const txt = await r.text();
    console.error(`  cloudinary HTTP ${r.status}: ${txt.slice(0, 200)}`);
    return null;
  }
  const j: any = await r.json();
  return j.secure_url || j.url || null;
}

async function main() {
  const supa = await prisma.story.findMany({
    where: { coverImage: { contains: 'supabase.co' } },
    select: { id: true, title: true, coverImage: true },
    orderBy: { id: 'asc' },
  });
  console.log(`Found ${supa.length} Supabase covers. APPLY=${APPLY}`);

  // Backup (only the rows we'd touch)
  const backupDir = path.resolve('local-data/backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `supabase-to-cloudinary-${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(supa, null, 2));
  console.log(`Backup written: ${backupFile}  (${supa.length} rows)`);

  const summary = { total: supa.length, ok: 0, skipped_already_cloudinary: 0, download_fail: 0, upload_fail: 0, updated: 0 };
  const failures: { id: string; title: string; stage: string; reason: string }[] = [];

  for (const s of supa) {
    if (!s.coverImage || /cloudinary\.com/i.test(s.coverImage)) {
      summary.skipped_already_cloudinary++;
      continue;
    }

    process.stdout.write(`[${s.id}] ${s.title.slice(0, 30).padEnd(30)}  ... `);

    // 1) download from Supabase
    const dl = await fetchSupabaseBuffer(s.coverImage);
    if (!dl.ok || !dl.buf) {
      const reason = dl.error || 'no buffer';
      console.log(`DOWNLOAD_FAIL (${reason})`);
      summary.download_fail++;
      failures.push({ id: s.id, title: s.title, stage: 'download', reason });
      continue;
    }

    // 2) upload to Cloudinary
    const publicId = s.id;
    const secureUrl = await uploadToCloudinary(dl.buf, publicId);
    if (!secureUrl) {
      console.log(`UPLOAD_FAIL`);
      summary.upload_fail++;
      failures.push({ id: s.id, title: s.title, stage: 'upload', reason: 'cloudinary rejected' });
      continue;
    }
    summary.ok++;

    // 3) write back
    if (APPLY) {
      try {
        await prisma.story.update({
          where: { id: s.id },
          data: { coverImage: secureUrl },
        });
        summary.updated++;
        console.log(`UPDATED -> ${secureUrl.slice(-50)}`);
      } catch (e: any) {
        console.log(`DB_FAIL: ${e?.message?.slice(0, 100)}`);
        failures.push({ id: s.id, title: s.title, stage: 'db', reason: e?.message });
      }
    } else {
      console.log(`WOULD_UPDATE -> ${secureUrl.slice(-50)}`);
    }

    // tiny pause to be polite to the CDN
    await new Promise(r => setTimeout(r, 80));
  }

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  [${f.stage}] ${f.id} ${f.title.slice(0, 30)} — ${f.reason}`);
  }
}

main()
  .catch(e => { console.error('FATAL', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
