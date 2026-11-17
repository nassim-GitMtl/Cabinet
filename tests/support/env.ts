// Point the runtime client at the TEST database before any app module loads.
import "dotenv/config";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
