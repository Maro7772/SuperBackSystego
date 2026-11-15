"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedAdminFromEnv = seedAdminFromEnv;
const Admin_1 = require("../models/schema/auth/Admin");
async function seedAdminFromEnv() {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    const adminName = process.env.ADMIN_NAME || "Super Admin";
    if (!adminEmail || !adminPassword) {
        return; // Nothing to seed without credentials
    }
    const existing = await Admin_1.AdminModel.findOne({ email: adminEmail });
    if (existing) {
        let needsUpdate = false;
        // ✅ تأكد إنه super_admin
        if (existing.role !== "super_admin") {
            existing.role = "super_admin";
            needsUpdate = true;
        }
        // ✅ لو الباسورد مش hashed، اعمله hash
        if (!existing.password.startsWith("$2")) {
            existing.password = adminPassword; // pre-save hook will hash
            needsUpdate = true;
        }
        if (needsUpdate) {
            await existing.save();
            // eslint-disable-next-line no-console
            console.log(`Updated existing admin "${adminEmail}" (role/password).`);
        }
        else {
            // eslint-disable-next-line no-console
            console.log(`Admin "${adminEmail}" already up-to-date.`);
        }
        return;
    }
    // ✅ إنشاء admin جديد (pre-save hook will hash password)
    await Admin_1.AdminModel.create({
        name: adminName,
        email: adminEmail,
        password: adminPassword,
        role: "super_admin",
    });
    // eslint-disable-next-line no-console
    console.log(`Seeded admin user: ${adminEmail}`);
}
