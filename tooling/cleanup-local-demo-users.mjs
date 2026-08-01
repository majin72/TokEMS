import { createRequire } from 'node:module';

const requireFromDatabase = createRequire(
  new URL('../packages/database/package.json', import.meta.url),
);
const { Pool } = requireFromDatabase('pg');

const ADMIN_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEMO_ORGANIZATION_UUID = '11111111-1111-4111-8111-111111111111';
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://conference:conference@localhost:15432/conference';
const confirm = process.argv.includes('--confirm');

function assertLocalDatabase() {
  const url = new URL(databaseUrl);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = hostname === 'localhost' || hostname === '::1' || hostname.startsWith('127.');
  if (process.env.DEPLOYMENT_MODE !== 'local' || !loopback) {
    throw new Error(
      'Cleanup is limited to DEPLOYMENT_MODE=local and a loopback PostgreSQL connection',
    );
  }
}

assertLocalDatabase();
const pool = new Pool({ connectionString: databaseUrl });

try {
  const preview = await pool.query(
    `select
       (select count(*)::integer from users where id <> $1) as staff_users,
       (select count(*)::integer from customer_users where organization_id = $2) as customer_users,
       (select count(*)::integer
          from registrations r
          join customer_users c on c.id = r.customer_user_id
         where c.organization_id = $2) as registrations,
       (select count(*)::integer
          from orders o
          join registrations r on r.id = o.registration_id
          join customer_users c on c.id = r.customer_user_id
         where c.organization_id = $2) as orders`,
    [ADMIN_UUID, DEMO_ORGANIZATION_UUID],
  );
  const counts = preview.rows[0];

  if (!confirm) {
    console.info('Local demo cleanup preview (no data changed):');
    console.table([counts]);
    console.info('Run pnpm db:cleanup-local-demo -- --confirm to apply this cleanup.');
  } else {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `create temporary table cleanup_customer_ids on commit drop as
           select id from customer_users where organization_id = $1`,
        [DEMO_ORGANIZATION_UUID],
      );
      await client.query(
        `create temporary table cleanup_registration_ids on commit drop as
           select id from registrations
            where customer_user_id in (select id from cleanup_customer_ids)`,
      );
      await client.query(
        'delete from orders where registration_id in (select id from cleanup_registration_ids)',
      );
      await client.query(
        'delete from registrations where id in (select id from cleanup_registration_ids)',
      );
      await client.query(
        'delete from customer_users where id in (select id from cleanup_customer_ids)',
      );
      await client.query('delete from users where id <> $1', [ADMIN_UUID]);
      await client.query(
        `do $$
         begin
           if to_regclass('public.public_user_ids') is not null then
             delete from public_user_ids;
             insert into public_user_ids (public_id, subject_type, subject_uuid)
             values (101, 'staff', '${ADMIN_UUID}');
             insert into user_id_allocators (scope, last_id)
             values ('global', 101)
             on conflict (scope) do update set last_id = excluded.last_id;
           end if;
         end $$`,
      );
      await client.query('commit');
      console.info('Local demo cleanup completed:');
      console.table([counts]);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
