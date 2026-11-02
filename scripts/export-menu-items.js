require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('../lib/db');

async function exportMenuItems() {
    try {
        console.log('Connecting to MongoDB...');

        await db.init({ seed: false });

        const items = await db.cols.items
            .find({ restaurant_id: 2 })
            .sort({ _id: 1 })
            .project({
                _id: 1,
                restaurant_id: 1,
                category_id: 1,
                name: 1,
                description: 1,
                price: 1,
                image: 1,
                available: 1
            })
            .toArray();

        const output = path.join(
            __dirname,
            '..',
            'menu-items.json'
        );

        fs.writeFileSync(
            output,
            JSON.stringify(items, null, 2),
            'utf8'
        );

        console.log('----------------------------');
        console.log('EXPORT SUCCESSFUL');
        console.log('Total items:', items.length);
        console.log('Saved to:', output);
        console.log('----------------------------');

    } catch (error) {
        console.error('Export failed:', error.message);
        process.exitCode = 1;

    } finally {
        await db.close();
    }
}

exportMenuItems();