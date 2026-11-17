import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { v2 as cloudinary } from 'cloudinary';

// Images go to Cloudinary when CLOUDINARY_URL is set (recommended: Render's disk is wiped on every deploy).
// Without it they are saved to ./uploads, which is fine for local development only.
const useCloud = !!process.env.CLOUDINARY_URL;
if (useCloud) cloudinary.config({ secure: true });

export const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

export async function saveImage(file: Express.Multer.File, folder = 'apostle-joshua'): Promise<{ url: string; publicId: string }> {
  if (useCloud) {
    const r: any = await new Promise((resolve, reject) => {
      const s = cloudinary.uploader.upload_stream({ folder, resource_type: 'image' }, (err, out) => (err ? reject(err) : resolve(out)));
      s.end(file.buffer);
    });
    return { url: r.secure_url, publicId: r.public_id };
  }
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const ext = (path.extname(file.originalname) || '.jpg').toLowerCase().replace(/[^.a-z0-9]/g, '');
  const name = crypto.randomBytes(12).toString('hex') + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), file.buffer);
  return { url: `/uploads/${name}`, publicId: `local:${name}` };
}

export async function deleteImage(publicId?: string | null): Promise<void> {
  if (!publicId) return;
  try {
    if (publicId.startsWith('local:')) {
      const f = path.join(UPLOAD_DIR, path.basename(publicId.slice(6)));
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } else if (useCloud) {
      await cloudinary.uploader.destroy(publicId);
    }
  } catch (e) {
    console.error('Could not delete image', publicId, e);
  }
}
