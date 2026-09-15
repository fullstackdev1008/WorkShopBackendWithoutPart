import { FastifyRequest } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { s3, S3_BUCKET } from '../../middleware/s3';
import { env } from '../../config/env';

// ─── Constants ────────────────────────────────────────────────────────────────
export const MAX_IMAGES_PER_VEHICLE = 8;
export const MIN_IMAGES_FOR_CONFIRM = 4;

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

// ─── Types ────────────────────────────────────────────────────────────────────
export interface UploadedFile {
  filename: string;
  originalName: string;
  path: string;
  mimetype: string;
}

// ─── Ensure uploads directory exists ─────────────────────────────────────────
const UPLOAD_DIR = path.resolve(process.cwd(), env.UPLOAD_DIR);
if (env.USE_LOCAL_STORAGE && !fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ─── Collect stream into Buffer ──────────────────────────────────────────────
async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// ─── Compress Image ───────────────────────────────────────────────────────────
// Resizes to max 1920px (preserving aspect ratio) and compresses to JPEG at
// 80% quality. PNG/JPG → JPEG. WebP → WebP 80%. Reduces typical 2–5 MB camera
// photos down to ~150–400 KB without visible quality loss.
const MAX_DIMENSION = 1920;
const COMPRESS_QUALITY = 80;

async function compressImage(
  buffer: Buffer,
  mimetype: string,
): Promise<{ buffer: Buffer; ext: string; mimetype: string }> {
  const image = sharp(buffer).rotate(); // .rotate() auto-corrects EXIF orientation

  const metadata = await image.metadata();
  const needsResize =
    (metadata.width ?? 0) > MAX_DIMENSION || (metadata.height ?? 0) > MAX_DIMENSION;

  const pipeline = needsResize
    ? image.resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    : image;

  if (mimetype === 'image/webp') {
    const compressed = await pipeline.webp({ quality: COMPRESS_QUALITY }).toBuffer();
    return { buffer: compressed, ext: '.webp', mimetype: 'image/webp' };
  }

  // JPEG, PNG, and anything else → JPEG (best compression for photos)
  const compressed = await pipeline.jpeg({ quality: COMPRESS_QUALITY, mozjpeg: true }).toBuffer();
  return { buffer: compressed, ext: '.jpg', mimetype: 'image/jpeg' };
}

// ─── Handle Multiple File Uploads ─────────────────────────────────────────────
export async function handleFileUploads(
  request: FastifyRequest,
): Promise<{ files: UploadedFile[]; fields: Record<string, string> }> {
  const uploadedFiles: UploadedFile[] = [];
  const fields: Record<string, string> = {};
  const parts = request.parts();

  for await (const part of parts) {
    if (part.type === 'field') {
      fields[part.fieldname] = part.value as string;
      continue;
    }
    if (part.type !== 'file') continue;

    const originalName = part.filename || 'unknown';
    const ext = path.extname(originalName).toLowerCase();

    if (!ALLOWED_EXTENSIONS.has(ext) || !ALLOWED_MIME_TYPES.has(part.mimetype)) {
      part.file.resume();
      throw new Error('Only image files (jpg, jpeg, png, webp) are allowed');
    }

    const rawBuffer = await streamToBuffer(part.file);
    const { buffer, ext: compressedExt, mimetype: compressedMimetype } =
      await compressImage(rawBuffer, part.mimetype);

    const uniqueFilename = `${randomUUID()}${compressedExt}`;

    if (env.USE_LOCAL_STORAGE) {
      // ── Save to local disk ──────────────────────────────────────────────
      const filePath = path.join(UPLOAD_DIR, uniqueFilename);
      fs.writeFileSync(filePath, buffer);

      uploadedFiles.push({
        filename: uniqueFilename,
        originalName,
        path: `uploads/${uniqueFilename}`,
        mimetype: compressedMimetype,
      });
    } else {
      // ── Upload to S3 ────────────────────────────────────────────────────
      const s3Key = `uploads/${uniqueFilename}`;
      await s3.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: s3Key,
          Body: buffer,
          ContentType: compressedMimetype,
        }),
      );

      uploadedFiles.push({
        filename: uniqueFilename,
        originalName,
        path: s3Key,
        mimetype: compressedMimetype,
      });
    }
  }

  return { files: uploadedFiles, fields };
}

// ─── Handle Single File Upload ────────────────────────────────────────────────
export async function handleSingleFileUpload(
  request: FastifyRequest,
): Promise<{ file: UploadedFile; fields: Record<string, string> }> {
  const { files, fields } = await handleFileUploads(request);
  if (files.length === 0) {
    throw new Error('No file uploaded');
  }
  return { file: files[0], fields };
}

// ─── Delete File ──────────────────────────────────────────────────────────────
export async function deleteFile(fileUrl: string): Promise<void> {
  try {
    if (env.USE_LOCAL_STORAGE) {
      // ── Delete from local disk ──────────────────────────────────────────
      const filename = path.basename(fileUrl);
      const filePath = path.join(UPLOAD_DIR, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } else {
      // ── Delete from S3 ──────────────────────────────────────────────────
      let s3Key: string;
      if (fileUrl.startsWith('https://')) {
        const url = new URL(fileUrl);
        s3Key = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
      } else {
        s3Key = fileUrl;
      }
      await s3.send(
        new DeleteObjectCommand({
          Bucket: S3_BUCKET,
          Key: s3Key,
        }),
      );
    }
  } catch {
    // Silently fail if file cannot be deleted
  }
}
