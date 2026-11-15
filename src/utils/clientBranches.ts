import mongoose from "mongoose";

/**
 * Branch names recorded directly on the client document (legacy).
 *
 * Older clients used to have their branches stored on the Super client record
 * (`branches_locations` / `branches_config`) before branches started being
 * managed inside each client's own admin. We keep them as a fallback so the
 * owner always sees something.
 */
export function legacyBranchNames(client: any): string[] {
  const fromLocations = Array.isArray(client?.branches_locations)
    ? client.branches_locations
    : [];
  const fromConfig = Array.isArray(client?.branches_config)
    ? client.branches_config.map((c: any) => c?.name)
    : [];

  return [...fromLocations, ...fromConfig]
    .map((n: any) => (typeof n === "string" ? n.trim() : ""))
    .filter(Boolean);
}

/**
 * Reads the branches (warehouses) that exist in a client's own database.
 *
 * - `dbName` is the client database name.
 * - Some clients (mainly newer ones) have no `db_name` stored, so we fall back
 *   to the provisioning convention `sc_<clientId>`.
 * - If the client database still yields nothing, we fall back to the legacy
 *   branch names on the client document, so every client shows its branches.
 *
 * Never throws: returns [] on any failure.
 */
export async function readClientBranches(
  dbName?: string,
  clientId?: any,
  legacyNames: string[] = [],
): Promise<any[]> {
  const resolvedDb =
    dbName || (clientId ? `sc_${String(clientId)}` : undefined);

  let branches: any[] = [];

  if (resolvedDb) {
    try {
      const clientDb = mongoose.connection.useDb(resolvedDb, {
        useCache: true,
      });

      const docs = await clientDb
        .collection("warehouses")
        .find(
          {},
          {
            projection: {
              name: 1,
              ar_name: 1,
              Is_Online: 1,
              enabled: 1,
              is_managed: 1,
              createdAt: 1,
            },
          },
        )
        .sort({ createdAt: 1 })
        .toArray();

      branches = docs.map((b: any) => ({
        _id: String(b._id),
        name: b.name,
        ar_name: b.ar_name,
        Is_Online: !!b.Is_Online,
        enabled: b.enabled !== false,
      }));
    } catch (error: any) {
      console.warn(
        `[clientBranches] Failed to read branches for db "${resolvedDb}": ${error.message}`,
      );
      branches = [];
    }
  }

  if (branches.length === 0 && legacyNames.length > 0) {
    branches = legacyNames.map((name, index) => ({
      _id: `legacy-${index}`,
      name,
      ar_name: "",
      Is_Online: false,
      enabled: true,
      legacy: true,
    }));
  }

  return branches;
}
