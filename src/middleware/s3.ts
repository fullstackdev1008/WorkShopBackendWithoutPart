import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env';

export const s3 = new S3Client({
  region: env.AWS_S3_REGION,
  ...(env.AWS_S3_ENDPOINT ? { endpoint: env.AWS_S3_ENDPOINT, forcePathStyle: true } : {}),
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

export const S3_BUCKET = env.AWS_S3_BUCKET;

const SIGNED_URL_EXPIRY = 3600;

export async function signUrl(keyOrUrl: string | null | undefined): Promise<string | null> {
  if (!keyOrUrl) return null;

  if (env.USE_LOCAL_STORAGE) {
    const filename = keyOrUrl.replace(/^uploads\//, '');
    return `${env.FILE_PATH}/uploads/${filename}`;
  }

  let key = keyOrUrl;
  if (keyOrUrl.startsWith('https://')) {
    const url = new URL(keyOrUrl);
    key = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
  }

  if (env.AWS_S3_ENDPOINT) {
    const projectBase = env.AWS_S3_ENDPOINT.replace('/storage/v1/s3', '');
    return `${projectBase}/storage/v1/object/public/${S3_BUCKET}/${key}`;
  }

  try {
    return await awsGetSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
      { expiresIn: SIGNED_URL_EXPIRY },
    );
  } catch {
    return null;
  }
}
