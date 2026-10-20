import { homedir } from "node:os";
import { join } from "node:path";

export const home = () => process.env.OPEN_DOT_HOME ?? join(homedir(), ".opendot");

export const databasePath = () => join(home(), "open-dot.db");

export const dotDirectory = (name: string) => join(home(), "dots", name);

/** Where a dot's workers run when it names no directory. Outside dots/, so workers get no dot tools. */
export const workDirectory = (name: string) => join(home(), "work", name);
