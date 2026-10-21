import "dotenv/config";
import {cleanEnv, str, port, bool, num} from "envalid";

export const env = cleanEnv(process.env,{
    PORT : port({ default: 3000 }),
    MONGO_URI: str(),
    JWT_SECRET: str(),
    ENCRYPTION_SECRET: str({desc: "Secret key used for AES-256-CBC field encryption"}),
    NODE_ENV: str({choices: ["development", "test", "production"],default: "development"}),
    // Release gate (plan §03): show closed-stage estimated_revenue as "Realised Revenue".
    // Off until Tech Lead / client approve; the API then returns supported:false.
    REALISED_REVENUE_PROXY: bool({ default: false }),
    // Comma-separated schedule_visits.status[].code values that mean "visit completed".
    // Empty = visit metrics are reported as unsupported instead of a false zero.
    VISIT_COMPLETED_STATUS_CODES: str({ default: "" }),
    DASHBOARD_QUERY_MAX_TIME_MS: num({ default: 2000 }),
    MONGO_MAX_POOL_SIZE: num({ default: 20 }),
});
