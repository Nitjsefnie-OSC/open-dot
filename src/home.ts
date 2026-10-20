import { homedir } from "node:os";
import { join } from "node:path";

export const home = () => process.env.OPEN_DOT_HOME ?? join(homedir(), ".opendot");

export const databasePath = () => join(home(), "open-dot.db");

export const dotDirectory = (name: string) => join(home(), "dots", name);
