"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const index_1 = __importDefault(require("./admin/index"));
const tenantRoutes_1 = __importDefault(require("./tenant/tenantRoutes"));
const PleskService_1 = require("../utils/PleskService");
const route = (0, express_1.Router)();
route.use('/admin', index_1.default);
route.use('/tenant', tenantRoutes_1.default);
route.get('/debug-node', async (req, res) => {
    try {
        const client = req.query.client || 'ggg';
        const domain = `${client}.systego.net`;
        if (req.query.fix === 'true') {
            const { diagnoseClient } = require('../utils/ClientProvisioner');
            return diagnoseClient({ body: { clientName: client, fix: true } }, res);
        }
        const results = { client, domain };
        // 1. Get Node.js CLI Help
        try {
            results.help = await (0, PleskService_1.executePleskCli)('extension', ['--call', 'nodejs', '--help']);
        }
        catch (e) {
            results.help = { error: e.message };
        }
        // 2. Get Domain Node.js Info
        try {
            results.info = await (0, PleskService_1.executePleskCli)('extension', ['--call', 'nodejs', '--info', '-domain', domain]);
        }
        catch (e) {
            results.info = { error: e.message };
        }
        // 3. Auto-configure Dry Run
        try {
            results.autoConfigureDryRun = await (0, PleskService_1.executePleskCli)('extension', ['--call', 'nodejs', '--auto-configure', '-domain', domain, '-dry-run']);
        }
        catch (e) {
            results.autoConfigureDryRun = { error: e.message };
        }
        // 4. If requested, apply auto-configure
        if (req.query.applyAuto === 'true') {
            try {
                results.appliedAutoConfigure = await (0, PleskService_1.executePleskCli)('extension', ['--call', 'nodejs', '--auto-configure', '-domain', domain]);
            }
            catch (e) {
                results.appliedAutoConfigure = { error: e.message };
            }
        }
        // Check backend error log and files
        const fs = require('fs/promises');
        const path = require('path');
        const backendDir = `/var/www/vhosts/systego.net/subdomains/api-${client}`;
        try {
            results.backendErrorLog = await fs.readFile(path.join(backendDir, 'startup-error.log'), 'utf-8');
        }
        catch (e) {
            results.backendErrorLog = e.message;
        }
        try {
            results.backendFiles = await fs.readdir(backendDir);
        }
        catch (e) {
            results.backendFiles = e.message;
        }
        try {
            results.backendNodeInfo = await (0, PleskService_1.executePleskCli)('extension', ['--call', 'nodejs', '--info', '-domain', `api-${client}.systego.net`]);
        }
        catch (e) {
            results.backendNodeInfo = e.message;
        }
        // Check subdomain info
        try {
            results.subdomainInfo = await (0, PleskService_1.executePleskCli)('subdomain', ['--info', domain]);
        }
        catch (e) {
            results.subdomainInfo = e.message;
        }
        // 5. If custom args provided
        if (req.query.cmd) {
            try {
                const args = req.query.cmd.split(' ');
                results.customCmd = await (0, PleskService_1.executePleskCli)('extension', ['--call', 'nodejs', ...args]);
            }
            catch (e) {
                results.customCmd = { error: e.message };
            }
        }
        // 6. Direct server shell execution for diagnostics and repairs
        if (req.query.exec) {
            const { exec } = require('child_process');
            const util = require('util');
            const execAsync = util.promisify(exec);
            try {
                const execRes = await execAsync(req.query.exec, { maxBuffer: 10 * 1024 * 1024 });
                results.execResult = { stdout: execRes.stdout, stderr: execRes.stderr };
            }
            catch (exErr) {
                results.execResult = { error: exErr.message, stdout: exErr.stdout, stderr: exErr.stderr };
            }
        }
        return res.json({ success: true, results });
    }
    catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});
exports.default = route;
