const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { put, del } = require('@vercel/blob');
const { UPLOAD_DIR } = require('./config');

// Allowed image types
const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
];

// Multer memory storage (Vercel-compatible)
const upload = multer({
    storage: multer.memoryStorage(),

    limits: {
        fileSize: 5 * 1024 * 1024
    },

    fileFilter: (_, file, cb) => {
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(Object.assign(
                new Error('Only JPEG, PNG, WebP and GIF images are allowed'),
                { status: 400 }
            ));
        }
    }
});

// Upload buffer to Vercel Blob
async function uploadBuffer(buffer, contentType, extension) {
    const filename = `${crypto.randomUUID()}.${extension}`;

    const localMode = process.env.NODE_ENV !== 'production' &&
        !process.env.VERCEL &&
        !process.env.BLOB_READ_WRITE_TOKEN &&
        !process.env.VERCEL_OIDC_TOKEN &&
        !process.env.BLOB_STORE_ID;

    if (localMode) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer, { flag: 'wx' });
        return filename;
    }

    const result = await put(filename, buffer, {
        access: 'public',
        contentType,
        addRandomSuffix: false
    });

    return result.url;
}

// Upload an image received through Multer
async function saveUploadedFile(file) {
    if (!file || !file.buffer) {
        return null;
    }

    const extensions = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif'
    };

    const extension = extensions[file.mimetype];

    if (!extension) {
        throw Object.assign(
            new Error('Unsupported image format'),
            { status: 400 }
        );
    }

    return uploadBuffer(
        file.buffer,
        file.mimetype,
        extension
    );
}

// Upload dashboard images received as Base64 data URLs
async function saveImageData(dataUrl) {
    const bad = msg => Object.assign(
        new Error(msg),
        { status: 400 }
    );

    const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(
        dataUrl || ''
    );

    if (!match) {
        throw bad('Image must be a PNG, JPEG or WebP file');
    }

    const buffer = Buffer.from(match[2], 'base64');

    if (buffer.length > 1500000) {
        throw bad('Image is too large (max about 1.5 MB)');
    }

    const contentType = `image/${match[1]}`;

    const extension = match[1] === 'jpeg'
        ? 'jpg'
        : match[1];

    return uploadBuffer(
        buffer,
        contentType,
        extension
    );
}

// Delete an image from Vercel Blob
async function removeImage(imageUrl) {
    if (!imageUrl) return;

    try {
        if (!/^https?:\/\//i.test(String(imageUrl))) {
            const value = String(imageUrl).replace(/^\/+/, '');
            const filename = value.startsWith('uploads/')
                ? value.slice('uploads/'.length)
                : value;

            if (!filename || filename.includes('/') || filename.includes('\\') || filename === '.' || filename === '..') {
                return;
            }

            const root = path.resolve(UPLOAD_DIR);
            const target = path.resolve(root, filename);
            if (!target.startsWith(root + path.sep)) return;
            await fs.promises.unlink(target).catch(error => {
                if (error.code !== 'ENOENT') throw error;
            });
            return;
        }

        const url = new URL(imageUrl);

        // Only delete images belonging to Vercel Blob
        if (!url.hostname.endsWith('.public.blob.vercel-storage.com')) {
            return;
        }

        await del(imageUrl);
    } catch (error) {
        console.error('Blob image deletion failed:', error.message);
    }
}

// Duplicate an image without breaking the original
async function copyImage(image) {
    if (!image) return null;

    try {
        let buffer;
        let contentType;

        if (image.startsWith('https://')) {
            const response = await fetch(image);

            if (!response.ok) {
                return null;
            }

            buffer = Buffer.from(await response.arrayBuffer());

            contentType = response.headers.get('content-type') || 'image/jpeg';
        } else {
            // Legacy local image support
            const filename = path.basename(image);
            const source = path.join(UPLOAD_DIR, filename);

            if (!fs.existsSync(source)) {
                return null;
            }

            buffer = fs.readFileSync(source);

            const extension = path.extname(filename).toLowerCase();

            contentType = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.webp': 'image/webp',
                '.gif': 'image/gif'
            }[extension] || 'image/jpeg';
        }

        const extensions = {
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp',
            'image/gif': 'gif'
        };

        const extension = extensions[contentType];

        if (!extension) return null;

        return await uploadBuffer(
            buffer,
            contentType,
            extension
        );

    } catch (error) {
        console.error('Image copy failed:', error.message);
        return null;
    }
}

module.exports = {
    upload,
    uploadBuffer,
    saveUploadedFile,
    saveImageData,
    removeImage,
    copyImage
};
