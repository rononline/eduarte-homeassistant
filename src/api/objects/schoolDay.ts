import {Subject} from "./subject";

interface SchoolDay {
    dateString: string;
    dateObject: Date;
    /** Local calendar date as YYYY-MM-DD; the key the store merges days on. */
    dateKey: string;
    subjects: Subject[];
}

export {SchoolDay};
