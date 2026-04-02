import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";


const pool = new Pool({
	connectionString : "postgresql://neondb_owner:npg_9aqHL3rlZCMD@ep-long-mountain-am4lmyak-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
});

pool.on("error", (error: Error) => {
	console.error("Unexpected PostgreSQL idle client error:", error);
})

export default pool;
