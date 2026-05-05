import { MigrationInterface, QueryRunner } from 'typeorm';

export class InventoryProcurementRecipePermissions1740000000043 implements MigrationInterface {
    name = 'InventoryProcurementRecipePermissions1740000000043';

    public async up(queryRunner: QueryRunner): Promise<void> {
        const newPermissions = [
            // Inventory
            {
                name: 'inventory:view',
                resource: 'inventory',
                action: 'view',
                description: 'View inventory and stock ledger',
            },
            {
                name: 'inventory:receive',
                resource: 'inventory',
                action: 'receive',
                description: 'Receive inventory via GRN and adjustments',
            },
            {
                name: 'inventory:adjust',
                resource: 'inventory',
                action: 'adjust',
                description: 'Post inventory adjustments',
            },
            {
                name: 'inventory:waste',
                resource: 'inventory',
                action: 'waste',
                description: 'Record wastage',
            },
            {
                name: 'inventory:stocktake',
                resource: 'inventory',
                action: 'stocktake',
                description: 'Create and close stocktakes',
            },
            {
                name: 'inventory:transfer',
                resource: 'inventory',
                action: 'transfer',
                description: 'Transfer inventory between branches',
            },
            {
                name: 'inventory:override_negative',
                resource: 'inventory',
                action: 'override_negative',
                description: 'Allow negative stock operations',
            },
            {
                name: 'inventory:override_fefo',
                resource: 'inventory',
                action: 'override_fefo',
                description: 'Override FEFO allocations',
            },

            // Procurement
            {
                name: 'procurement:pr:create',
                resource: 'procurement',
                action: 'pr_create',
                description: 'Create purchase requisitions',
            },
            {
                name: 'procurement:pr:approve',
                resource: 'procurement',
                action: 'pr_approve',
                description: 'Approve or reject purchase requisitions',
            },
            {
                name: 'procurement:po:manage',
                resource: 'procurement',
                action: 'po_manage',
                description: 'Manage purchase orders',
            },
            {
                name: 'procurement:grn:post',
                resource: 'procurement',
                action: 'grn_post',
                description: 'Post goods receipt notes',
            },

            // Recipes/costing
            {
                name: 'recipes:manage',
                resource: 'recipes',
                action: 'manage',
                description: 'Manage recipes and versions',
            },
            {
                name: 'costing:view',
                resource: 'costing',
                action: 'view',
                description: 'View recipe costing and margins',
            },
        ];

        for (const p of newPermissions) {
            await queryRunner.query(
                `INSERT INTO permissions (name, resource, action, description)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (name) DO NOTHING`,
                [p.name, p.resource, p.action, p.description],
            );
        }

        // Assign all new permissions to owner and super_admin
        for (const p of newPermissions) {
            await queryRunner.query(
                `INSERT INTO role_permissions (role_id, permission_id)
                 SELECT r.id, p.id
                 FROM roles r
                 CROSS JOIN permissions p
                 WHERE r.slug IN ('owner', 'super_admin') AND p.name = $1
                 AND NOT EXISTS (
                    SELECT 1 FROM role_permissions rp
                    WHERE rp.role_id = r.id AND rp.permission_id = p.id
                 )`,
                [p.name],
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const names = [
            'inventory:view',
            'inventory:receive',
            'inventory:adjust',
            'inventory:waste',
            'inventory:stocktake',
            'inventory:transfer',
            'inventory:override_negative',
            'inventory:override_fefo',
            'procurement:pr:create',
            'procurement:pr:approve',
            'procurement:po:manage',
            'procurement:grn:post',
            'recipes:manage',
            'costing:view',
        ];
        for (const name of names) {
            await queryRunner.query('DELETE FROM permissions WHERE name = $1', [
                name,
            ]);
        }
    }
}
