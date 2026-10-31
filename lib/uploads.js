const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const config = require('./config');

const UPLOAD_DIR = config.UPLOAD_DIR;

// Stop with a clear error if the configuration is incorrect.
if (!UPLOAD_DIR || typeof UPLOAD_DIR !== 'string') {
    throw new Error(
        'UPLOAD_DIR is missing. Check module.exports in lib/config.js'
    );
}

// Create the uploads directory.
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, UPLOAD_DIR);
        },

        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase();
            cb(null, crypto.randomUUID() + ext);
        }
    }),

    limits: {
        fileSize: 5 * 1024 * 1024
    },

    fileFilter: (req, file, cb) => {
        const allowed = /^image\/(jpeg|png|webp|gif)$/;

        if (!allowed.test(file.mimetype)) {
            return cb(new Error('Only JPG, PNG, WEBP and GIF images are allowed'));
        }

        cb(null, true);
    }
});

function removeImage(name) {
    if (!name) return;

    fs.rm(
        path.join(UPLOAD_DIR, path.basename(name)),
        { force: true },
        () => {}
    );
}

function saveImageData(dataUrl) {
    const bad = message =>
        Object.assign(new Error(message), { status: 400 });

    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/
        .exec(dataUrl || '');

    if (!match) {
        throw bad('Image must be PNG, JPEG or WebP');
    }

    const buffer = Buffer.from(match[2], 'base64');

    if (buffer.length > 1500000) {
        throw bad('Image is too large (maximum 1.5 MB)');
    }

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];

    const filename = `${crypto.randomUUID()}.${ext}`;

    fs.writeFileSync(
        path.join(UPLOAD_DIR, filename),
        buffer
    );

    return filename;
}

function copyImage(name) {
    if (!name) return null;

    const source = path.join(
        UPLOAD_DIR,
        path.basename(name)
    );

    if (!fs.existsSync(source)) return null;

    const filename =
        crypto.randomUUID() + path.extname(source);

    fs.copyFileSync(
        source,
        path.join(UPLOAD_DIR, filename)
    );

    return filename;
}

module.exports = {
    upload,
    removeImage,
    saveImageData,
    copyImage
};