import "dotenv/config";
import { importHistoryFile } from "./memory/history.js";
import { countMessages, openDatabase } from "./memory/db.js";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run import -- fixtures/history.jsonl");
  process.exit(1);
}

const db = openDatabase();
const added = importHistoryFile(db, file);
console.log(`Imported ${added} messages. The store now has ${countMessages(db)}.`);
