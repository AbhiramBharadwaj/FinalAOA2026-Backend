import path from 'path';

const DEFAULT_UPLOAD_ROOT = 'uploads';

export const getUploadRoot = () =>
  path.resolve(process.env.UPLOAD_ROOT || DEFAULT_UPLOAD_ROOT);

export const getUploadDirectory = (subdirectory) =>
  path.join(getUploadRoot(), subdirectory);

// Keep stored paths and public URLs independent from the physical upload root.
export const getPublicUploadPath = (subdirectory, filename) =>
  path.posix.join('uploads', subdirectory, filename);
