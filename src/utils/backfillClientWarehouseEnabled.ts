import mongoose from "mongoose";
import { ClientModel } from "../models/schema/auth/Client";

/**
 * Legacy client databases contain branches created before the `enabled`
 * flag existed on the Warehouse schema. Those documents have no `enabled`
 * field, so the tenant dashboard's `{ enabled: true }` filter hides them.
 *
 * The super admin already knows every client database (`Client.db_name`),
 * so this runs once after the super admin starts and backfills all clients
 * automatically. It is idempotent and only touches branches where the flag
 * is missing/null; explicitly disabled branches (`enabled: false`) are kept.
 */
export async function backfillClientWarehouseEnabled(): Promise<void> {
  const clients = await ClientModel.find(
    {},
    { _id: 1, company_name: 1, db_name: 1 },
  ).lean();

  let totalUpdated = 0;
  let failedDatabases = 0;

  for (const client of clients) {
    const dbName = client.db_name || `sc_${String(client._id)}`;

    try {
      const clientDb = mongoose.connection.useDb(dbName, {
        useCache: true,
      });

      const result = await clientDb.collection("warehouses").updateMany(
        {
          $or: [{ enabled: { $exists: false } }, { enabled: null }],
        },
        { $set: { enabled: true } },
      );

      if (result.modifiedCount > 0) {
        totalUpdated += result.modifiedCount;
        console.log(
          `[warehouse-backfill] ${client.company_name || dbName}: enabled ${result.modifiedCount} legacy branch(es)`,
        );
      }
    } catch (error: any) {
      failedDatabases++;
      console.warn(
        `[warehouse-backfill] Failed for database "${dbName}": ${error.message}`,
      );
    }
  }

  console.log(
    `[warehouse-backfill] Done. Updated ${totalUpdated} legacy branch(es)` +
      (failedDatabases > 0
        ? `; ${failedDatabases} database(s) could not be reached`
        : ""),
  );
}
