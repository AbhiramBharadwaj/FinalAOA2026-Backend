import { createHash } from 'node:crypto';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export function certificateObjectClient() {
  const bucket = process.env.CERTIFICATE_BUCKET_NAME || process.env.R2_PRIVATE_BUCKET_NAME;
  const endpoint = process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '');
  if (!bucket || !endpoint || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
    throw Object.assign(new Error('Certificate storage is not configured.'), { status: 503 });
  }
  const client = new S3Client({ region: 'auto', endpoint, forcePathStyle: true,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
    maxAttempts: 2 });
  return { client, bucket };
}

export function certificateStorage() {
  const { client, bucket } = certificateObjectClient();
  return {
    async put(buffer, contentType) {
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf' }[contentType];
      const objectKey = `certificates/2026/${sha256}.${extension}`;
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: buffer, ContentType: contentType }));
      return { objectKey, sha256, contentType };
    },
    async read(row) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: row.objectKey }));
      const bytes = Buffer.from(await result.Body.transformToByteArray());
      if (bytes.length > 12 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== row.sha256) {
        throw new Error('Certificate file failed integrity verification.');
      }
      return bytes;
    },
    async download(row) {
      const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf' }[row.contentType];
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: row.objectKey,
        ResponseContentDisposition: `attachment; filename="AOACON-${row.publicId}.${extension}"`,
        ResponseContentType: row.contentType }), { expiresIn: 120 });
    },
  };
}
