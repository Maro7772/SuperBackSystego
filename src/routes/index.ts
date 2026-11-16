import { Router, Request, Response } from "express";
import adminRouter from './admin/index';
import tenantRouter from './tenant/tenantRoutes';
import { executePleskCli } from '../utils/PleskService';

const route = Router();

route.use('/admin', adminRouter);
route.use('/tenant', tenantRouter);

route.get('/debug-node', async (req: Request, res: Response) => {
    try {
        const client = (req.query.client as string) || 'ggg';
        const domain = `${client}.systego.net`;

        if (req.query.fix === 'true') {
            const { diagnoseClient } = require('../utils/ClientProvisioner');
            return diagnoseClient({ body: { clientName: client, fix: true } } as any, res as any);
        }

        const results: Record<string, any> = { client, domain };

        // 1. Get Node.js CLI Help
        try {
            results.help = await executePleskCli('extension', ['--call', 'nodejs', '--help']);
        } catch (e: any) {
            results.help = { error: e.message };
        }

        // 2. Get Domain Node.js Info
        try {
            results.info = await executePleskCli('extension', ['--call', 'nodejs', '--info', '-domain', domain]);
        } catch (e: any) {
            results.info = { error: e.message };
        }

        // 3. Auto-configure Dry Run
        try {
            results.autoConfigureDryRun = await executePleskCli('extension', ['--call', 'nodejs', '--auto-configure', '-domain', domain, '-dry-run']);
        } catch (e: any) {
            results.autoConfigureDryRun = { error: e.message };
        }

        // 4. If requested, apply auto-configure
        if (req.query.applyAuto === 'true') {
            try {
                results.appliedAutoConfigure = await executePleskCli('extension', ['--call', 'nodejs', '--auto-configure', '-domain', domain]);
            } catch (e: any) {
                results.appliedAutoConfigure = { error: e.message };
            }
        }

        // 5. If custom args provided
        if (req.query.cmd) {
            try {
                const args = (req.query.cmd as string).split(' ');
                results.customCmd = await executePleskCli('extension', ['--call', 'nodejs', ...args]);
            } catch (e: any) {
                results.customCmd = { error: e.message };
            }
        }

        return res.json({ success: true, results });
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

export default route;
