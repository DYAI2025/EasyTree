import "reflect-metadata";

/**
 * Test environment for the strict `test` preset of @easytree/config:
 * the test preset has NO defaults on purpose, so every variable is stated
 * explicitly here. Values are synthetic placeholders — no real backends
 * are contacted by this suite.
 */
process.env["NODE_ENV"] = "test";
process.env["DATABASE_URL"] = "postgresql://localhost:54322/postgres";
process.env["SUPABASE_URL"] = "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] = "test-anon-placeholder";
process.env["API_PORT"] = "3199";
process.env["LOG_LEVEL"] = "error";
