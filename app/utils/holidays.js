// ============================================================================
// DATE UTILITIES
// ============================================================================

/**
 * Add days to a date
 */
export function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Format date as YYYY-MM-DD
 */
export function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ============================================================================
// EASTER & HOLIDAY CALCULATION HELPERS
// ============================================================================

/**
 * Calculate Easter Sunday for a given year using the Anonymous Gregorian algorithm
 * This is the basis for many moveable Christian holidays
 */
export function getEasterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/**
 * Calculate Orthodox Easter using the Julian calendar algorithm
 * Used by Greece, Romania, and other Orthodox countries
 */
export function getOrthodoxEaster(year) {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  // Convert from Julian to Gregorian calendar (add 13 days for 1900-2099)
  const julianDate = new Date(year, month - 1, day);
  julianDate.setDate(julianDate.getDate() + 13);
  return julianDate;
}

/**
 * Get the nth occurrence of a specific weekday in a month
 * @param year - The year
 * @param month - Month (0-11)
 * @param weekday - Day of week (0=Sunday, 1=Monday, etc.)
 * @param n - Which occurrence (1=first, 2=second, etc., -1=last)
 */
export function getNthWeekdayOfMonth(year, month, weekday, n) {
  if (n === -1) {
    // Last occurrence of weekday in month
    const lastDay = new Date(year, month + 1, 0);
    const diff = (lastDay.getDay() - weekday + 7) % 7;
    return new Date(year, month, lastDay.getDate() - diff);
  }

  const firstDay = new Date(year, month, 1);
  const firstWeekday = firstDay.getDay();
  let dayOfMonth = 1 + ((weekday - firstWeekday + 7) % 7) + (n - 1) * 7;
  return new Date(year, month, dayOfMonth);
}


/**
 * Get the Saturday between June 20-26 (Swedish Midsummer)
 */
export function getMidsummerDay(year) {
  // Midsummer Day is the Saturday between June 20-26
  for (let d = 20; d <= 26; d++) {
    const date = new Date(year, 5, d); // June is month 5
    if (date.getDay() === 6) return date;
  }
  return new Date(year, 5, 20);
}

/**
 * Get All Saints Day for countries that observe it on Saturday
 * (Saturday between Oct 31 - Nov 6)
 */
function getAllSaintsSaturday(year) {
  for (let d = 31; d <= 31; d++) {
    const date = new Date(year, 9, d);
    if (date.getDay() === 6) return date;
  }
  for (let d = 1; d <= 6; d++) {
    const date = new Date(year, 10, d);
    if (date.getDay() === 6) return date;
  }
  return new Date(year, 10, 1);
}

// ============================================================================
// COUNTRY HOLIDAY DEFINITIONS
// ============================================================================

/**
 * Each country defines its holidays as a function that returns dates for a given year
 * Holiday types:
 * - Fixed: Same date every year (e.g., Jan 1, Dec 25)
 * - Easter-based: Offset from Easter Sunday
 * - Nth weekday: e.g., "first Monday of May"
 */
export const HOLIDAY_DEFINITIONS = {
  // === Europe ===
  AT: {
    name: "Austria",
    getHolidays: (year) => {
      const easter = getEasterSunday(year);
      return [
        `${year}-01-01`, // New Year's Day
        `${year}-01-06`, // Epiphany
        formatDate(addDays(easter, 1)), // Easter Monday
        `${year}-05-01`, // Labour Day
        formatDate(addDays(easter, 39)), // Ascension Day
        formatDate(addDays(easter, 50)), // Whit Monday
        formatDate(addDays(easter, 60)), // Corpus Christi
        `${year}-08-15`, // Assumption
        `${year}-10-26`, // National Day
        `${year}-11-01`, // All Saints
        `${year}-12-08`, // Immaculate Conception
        `${year}-12-25`, // Christmas
        `${year}-12-26`, // St. Stephen's Day
      ];
    },
  },
  BE: {
    name: "Belgium",
    getHolidays: (year) => {
      const easter = getEasterSunday(year);
      return [
        `${year}-01-01`, // New Year's Day
        formatDate(addDays(easter, 1)), // Easter Monday
        `${year}-05-01`, // Labour Day
        formatDate(addDays(easter, 39)), // Ascension Day
        formatDate(addDays(easter, 50)), // Whit Monday
        `${year}-07-21`, // Belgian National Day
        `${year}-08-15`, // Assumption
        `${year}-11-01`, // All Saints
        `${year}-11-11`, // Armistice Day
        `${year}-12-25`, // Christmas
      ];
    },
  },
  CH: {
    name: "Switzerland",
    getHolidays: (year) => {
      const easter = getEasterSunday(year);
      return [
        `${year}-01-01`, // New Year's Day
        `${year}-01-02`, // Berchtold's Day
        formatDate(addDays(easter, -2)), // Good Friday
        formatDate(addDays(easter, 1)), // Easter Monday
        formatDate(addDays(easter, 39)), // Ascension Day
        formatDate(addDays(easter, 50)), // Whit Monday
        `${year}-08-01`, // Swiss National Day
        `${year}-12-25`, // Christmas
        `${year}-12-26`, // St. Stephen's Day
      ];
    },
  },
  CZ: {
    name: "Czech Republic",
    getHolidays: (year) => {
      const easter = getEasterSunday(year);
      return [
        `${year}-01-01`, // New Year's Day
        formatDate(addDays(easter, -2)), // Good Friday
        formatDate(addDays(easter, 1)), // Easter Monday
        `${year}-05-01`, // Labour Day
        `${year}-05-08`, // Liberation Day
        `${year}-07-05`, // Saints Cyril and Methodius
        `${year}-07-06`, // Jan Hus Day
        `${year}-09-28`, // Czech Statehood Day
        `${year}-10-28`, // Independence Day
        `${year}-11-17`, // Struggle for Freedom Day
        `${year}-12-24`, // Christmas Eve
        `${year}-12-25`, // Christmas
        `${year}-12-26`, // St. Stephen's Day
      ];
    },
  },
  DE: {
    name: "Germany",
    getHolidays: (year) => {
      const easter = getEasterSunday(year);
      return [
        `${year}-01-01`, // New Year's Day
        formatDate(addDays(easter, -2)), // Good Friday
        formatDate(addDays(easter, 1)), // Easter Monday
        `${year}-05-01`, // Labour Day
        formatDate(addDays(easter, 39)), // Ascension Day
        formatDate(addDays(easter, 50)), // Whit Monday
        `${year}-10-03`, // German Unity Day
        `${year}-12-25`, // Christmas
        `${year}-12-26`, // St. Stephen's Day
      ];
    },
  },
  DK: {
    name: "Denmark",
    getHolidays: (year) => {
      const easter = getEasterSunday(year);
      return [
        `${year}-01-01`, // New Year's Day
        formatDate(addDays(easter, -3)), // Maundy Thursday
        formatDate(addDays(easter, -2)), // Good Friday
        formatDate(addDays(easter, 1)), // Easter Monday
        formatDate(addDays(easter, 26)), // Store Bededag (Great Prayer Day)
        formatDate(addDays(easter, 39)), // Ascension Day
        `${year}-06-05`, // Constitution Day
        formatDate(addDays(easter, 50)), // Whit Monday
        `${year}-12-25`, // Christmas
        `${year}-12-26`, // Second Christmas Day
      ];
    },
  },
  ES: {
    name: "Spain",
    getHolidays: (year) => {
      const easter = getEasterSunday(year);
      return [
        `${year}-01-01`, // New Year's Day
        `${year}-01-06`, // Epiphany
        formatDate(addDays(easter, -2)), // Good Friday
        `${year}-05-01`, // Labour Day
        `${year}-08-15`, // Assumption
        `${year}-10-12`, // Hispanic Day
        `${year}-11-01`, // All Saints
        `${year}-12-06`, // Constitution Day
        `${year}-12-08`, // Immaculate Conception
        `${year}-12-25`, // Christmas
      ];
    },
  },
  FI: {
    name: "Finland",
    getHolidays: (year) => {
      const easter = getEasterSunday(year);
      const midsummer = getMidsummerDay(year);
      const allSaints = getAllSaintsSaturday(year);
      return [
        `${year}-01-01`, // New Year's Day
        `${year}-01-06`, // Epiphany
        formatDate(addDays(easter, -2)), // Good Friday
        formatDate(addDays(easter, 1)), // Easter Monday
        `${year}-05-01`, // May Day
        formatDate(addDays(easter, 39)), // Ascension Day
        formatDate(addDays(midsummer, -1)), // Midsummer Eve
        formatDate(midsummer), // Midsummer Day
        formatDate(allSaints), // All Saints (Saturday)
        `${year}-12-06`, // Independence Day
        `${year}-12-24`, // Christmas Eve
        `${year}-12-25`, // Christmas
        `${year}-12-26`, // St. Stephen's Day
      ];
    },
  },
  FR: {
    name: "France",
    getHolidays: (year) => {
      const easter = getEasterSunday(year);
      return [
        `${year}-01-01`, // New Year's Day
        formatDate(addDays(easter, 1)), // Easter Monday
        `${year}-05-01`, // Labour Day
        `${year}-05-08`, // Victory in Europe Day
        formatDate(addDays(easter, 39)), // Ascension Day
        formatDate(addDays(easter, 50)), // Whit Monday
        `${year}-07-14`, // Bastille Day
        `${year}-08-15`, // Assumption
        `${year}-11-01`, // All Saints
        `${year}-11-11`, // Armistice Day
        `${year}-12-25`, // Christmas
      ];
    },
  },
  GB: {
    name: "United Kingdom",
    getHolidays: (year) => {
      const easter = getEasterSunday(year);
      const earlyMay = getNthWeekdayOfMonth(year, 4, 1, 1); // First Monday of May
      const spring = getNthWeekdayOfMonth(year, 4, 1, -1); // Last Monday of May
      const summer = getNthWeekdayOfMonth(year, 7, 1, -1); // Last Monday of August

      const holidays = [
        `${year}-01-01`, // New Year's Day
        formatDate(addDays(easter, -2)), // Good Friday
        formatDate(addDays(easter, 1)), // Easter Monday
        formatDate(earlyMay), // Early May Bank Holiday
        formatDate(spring), // Spring Bank Holiday
        formatDate(summer), // Summer Bank Holiday
        `${year}-12-25`, // Christmas
        `${year}-12-26`, // Boxing Day
      ];

      // Handle substitute days if Christmas/Boxing Day falls on weekend
      const christmas = new Date(year, 11, 25);
      const boxingDay = new Date(year, 11, 26);
      if (christmas.getDay() === 0) {
        holidays.push(`${year}-12-27`); // Substitute for Christmas
      } else if (christmas.getDay() === 6) {
        holidays.push(`${year}-12-27`); // Substitute for Boxing Day
        holidays.push(`${year}-12-28`); // Substitute for Christmas (if both on weekend)
      }
      if (boxingDay.getDay() === 0) {
        holidays.push(`${year}-12-28`); // Substitute for Boxing Day
      }

      return holidays;
    },
  },
  GR: {
    name: "Greece",
    getHolidays: (year) => {
      const orthodoxEaster = getOrthodoxEaster(year);
      return [
        `${year}-01-01`, // New Year's Day
        `${year}-01-06`, // Epiphany
        formatDate(addDays(orthodoxEaster, -48)), // Clean Monday (start of Lent)
        `${year}-03-25`, // Independence Day
        formatDate(addDays(orthodoxEaster, -2)), // Good Friday
        formatDate(orthodoxEaster), // Easter Sunday
        formatDate(addDays(orthodoxEaster, 1)), // Easter Monday
        `${year}-05-01`, // Labour Day
        formatDate(addDays(orthodoxEaster, 50)), // Whit Monday
        `${year}-08-15`, // Assumption
        `${year}-10-28`, // Ochi Day
        `${year}-12-25`, // Christmas
        `${year}-12-26`, // Second Christmas Day
      ];
    },
  },
  HU: {
    name: "Hungary",
    getHolidays: (year) => {
      const easter = getEasterSunday(year);
      return [
        `${year}-01-01`, // New Year's Day
        `${year}-03-15`, // National Day
        formatDate(addDays(easter, -2)), // Good Friday
        formatDate(addDays(easter, 1)), // Easter Monday
        `${year}-05-01`, // Labour Day
        formatDate(addDays(easter, 49)), // Whit Sunday
        formatDate(addDays(easter, 50)), // Whit Monday
        `${year}-08-20`, // St. Stephen's Day
        `${year}-10-23`, // Republic Day
        `${year}-11-01`, // All Saints
        `${year}-12-25`, // Christmas
        `${year}-12-26`, // Second Christmas Day
      ];
    },
  },
  IE: {
    name: "Ireland",
    getHolidays: (year) => {
      const easter = getEasterSunday(year);
      const stBrigid = getNthWeekdayOfMonth(year, 1, 1, 1); // First Monday of February
      const mayBH = getNthWeekdayOfMonth(year, 4, 1, 1); // First Monday of May
      const juneBH = getNthWeekdayOfMonth(year, 5, 1, 1); // First Monday of June
      const augBH = getNthWeekdayOfMonth(year, 7, 1, 1); // First Monday of August
      const octBH = getNthWeekdayOfMonth(year, 9, 1, -1); // Last Monday of October

      const holidays = [
        `${year}-01-01`, // New Year's Day
        formatDate(stBrigid), // St. Brigid's Day
        `${year}-03-17`, // St. Patrick's Day
        formatDate(addDays(easter, 1)), // Easter Monday
        formatDate(mayBH), // May Bank Holiday
        formatDate(juneBH), // June Bank Holiday
        formatDate(augBH), // August Bank Holiday
        formatDate(octBH), // October Bank Holiday
        `${year}-12-25`, // Christmas
        `${year}-12-26`, // St. Stephen's Day
      ];

      // Handle substitute days
      const christmas = new Date(year, 11, 25);
      if (christmas.getDay() === 0) {
        holidays.push(`${year}-12-27`);
      } else if (christmas.getDay() === 6) {
        holidays.push(`${year}-12-27`);
        holidays.push(`${year}-12-28`);
      }

      return holidays;
    },
  },
  IT: {
    name: "Italy",
    getHolidays: (year) => {
      const easter = getEasterSunday(year);
      return [
        `${year}-01-01`, // New Year's Day
        `${year}-01-06`, // Epiphany
        formatDate(easter), // Easter Sunday
        formatDate(addDays(easter, 1)), // Easter Monday
        `${year}-04-25`, // Liberation Day
        `${year}-05-01`, // Labour Day
        `${year}-06-02`, // Republic Day
        `${year}-08-15`, // Assumption
        `${year}-11-01`, // All Saints
        `${year}-12-08`, // Immaculate Conception
        `${year}-12-25`, // Christmas
        `${year}-12-26`, // St. Stephen's Day
      ];
    },
  },
  LU: {
    name: "Luxembourg",
    getHolidays: (year) => {
      const easter = getEasterSunday(year);
      return [
        `${year}-01-01`, // New Year's Day
        formatDate(addDays(easter, 1)), // Easter Monday
        `${year}-05-01`, // Labour Day
        `${year}-05-09`, // Europe Day
        formatDate(addDays(easter, 39)), // Ascension Day
        formatDate(addDays(easter, 50)), // Whit Monday
        `${year}-06-23`, // National Day
        `${year}-08-15`, // Assumption
        `${year}-11-01`, // All Saints
        `${year}-12-25`, // Christmas
        `${year}-12-26`, // St. Stephen's Day
      ];
    },
  },
  NL: {
    name: "Netherlands",
    getHolidays: (year) => {
      const easter = getEasterSunday(year);
      // King's Day is April 27, unless it's Sunday then April 26
      let kingsDay = new Date(year, 3, 27);
      if (kingsDay.getDay() === 0) kingsDay = new Date(year, 3, 26);

      return [
        `${year}-01-01`, // New Year's Day
        formatDate(addDays(easter, -2)), // Good Friday
        formatDate(addDays(easter, 1)), // Easter Monday
        formatDate(kingsDay), // King's Day
        `${year}-05-05`, // Liberation Day
        formatDate(addDays(easter, 39)), // Ascension Day
        formatDate(addDays(easter, 50)), // Whit Monday
        `${year}-12-25`, // Christmas
        `${year}-12-26`, // Second Christmas Day
      ];
    },
  },
  NO: {
    name: "Norway",
    getHolidays: (year) => {
      const easter = getEasterSunday(year);
      return [
        `${year}-01-01`, // New Year's Day
        formatDate(addDays(easter, -3)), // Maundy Thursday
        formatDate(addDays(easter, -2)), // Good Friday
        formatDate(addDays(easter, 1)), // Easter Monday
        `${year}-05-01`, // Labour Day
        `${year}-05-17`, // Constitution Day
        formatDate(addDays(easter, 39)), // Ascension Day
        formatDate(addDays(easter, 50)), // Whit Monday
        `${year}-12-25`, // Christmas
        `${year}-12-26`, // Second Christmas Day
      ];
    },
  },
  PL: {
    name: "Poland",
    getHolidays: (year) => {
      const easter = getEasterSunday(year);
      return [
        `${year}-01-01`, // New Year's Day
        `${year}-01-06`, // Epiphany
        formatDate(easter), // Easter Sunday
        formatDate(addDays(easter, 1)), // Easter Monday
        `${year}-05-01`, // Labour Day
        `${year}-05-03`, // Constitution Day
        formatDate(addDays(easter, 49)), // Whit Sunday
        formatDate(addDays(easter, 60)), // Corpus Christi
        `${year}-08-15`, // Assumption
        `${year}-11-01`, // All Saints
        `${year}-11-11`, // Independence Day
        `${year}-12-25`, // Christmas
        `${year}-12-26`, // Second Christmas Day
      ];
    },
  },
  PT: {
    name: "Portugal",
    getHolidays: (year) => {
      const easter = getEasterSunday(year);
      return [
        `${year}-01-01`, // New Year's Day
        formatDate(addDays(easter, -47)), // Carnival
        formatDate(addDays(easter, -2)), // Good Friday
        formatDate(easter), // Easter Sunday
        `${year}-04-25`, // Freedom Day
        `${year}-05-01`, // Labour Day
        formatDate(addDays(easter, 60)), // Corpus Christi
        `${year}-06-10`, // Portugal Day
        `${year}-08-15`, // Assumption
        `${year}-10-05`, // Republic Day
        `${year}-11-01`, // All Saints
        `${year}-12-01`, // Restoration of Independence
        `${year}-12-08`, // Immaculate Conception
        `${year}-12-25`, // Christmas
      ];
    },
  },
  RO: {
    name: "Romania",
    getHolidays: (year) => {
      const orthodoxEaster = getOrthodoxEaster(year);
      return [
        `${year}-01-01`, // New Year's Day
        `${year}-01-02`, // Day after New Year
        `${year}-01-24`, // Unification Day
        formatDate(addDays(orthodoxEaster, -2)), // Good Friday
        formatDate(orthodoxEaster), // Easter Sunday
        formatDate(addDays(orthodoxEaster, 1)), // Easter Monday
        `${year}-05-01`, // Labour Day
        formatDate(addDays(orthodoxEaster, 49)), // Whit Sunday
        formatDate(addDays(orthodoxEaster, 50)), // Whit Monday
        `${year}-06-01`, // Children's Day
        `${year}-08-15`, // Assumption
        `${year}-11-30`, // St. Andrew's Day
        `${year}-12-01`, // National Day
        `${year}-12-25`, // Christmas
        `${year}-12-26`, // Second Christmas Day
      ];
    },
  },
  SE: {
    name: "Sweden",
    getHolidays: (year) => {
      const easter = getEasterSunday(year);
      const midsummer = getMidsummerDay(year);
      const allSaints = getAllSaintsSaturday(year);
      return [
        `${year}-01-01`, // New Year's Day
        `${year}-01-06`, // Epiphany
        formatDate(addDays(easter, -2)), // Good Friday
        formatDate(addDays(easter, 1)), // Easter Monday
        `${year}-05-01`, // Labour Day
        formatDate(addDays(easter, 39)), // Ascension Day
        `${year}-06-06`, // National Day
        formatDate(addDays(midsummer, -1)), // Midsummer Eve
        formatDate(midsummer), // Midsummer Day
        formatDate(allSaints), // All Saints (Saturday)
        `${year}-12-24`, // Christmas Eve
        `${year}-12-25`, // Christmas
        `${year}-12-26`, // Second Christmas Day
      ];
    },
  },
  SK: {
    name: "Slovakia",
    getHolidays: (year) => {
      const easter = getEasterSunday(year);
      return [
        `${year}-01-01`, // New Year's Day / Republic Day
        `${year}-01-06`, // Epiphany
        formatDate(addDays(easter, -2)), // Good Friday
        formatDate(addDays(easter, 1)), // Easter Monday
        `${year}-05-01`, // Labour Day
        `${year}-05-08`, // Victory Day
        `${year}-07-05`, // Saints Cyril and Methodius
        `${year}-08-29`, // Slovak National Uprising
        `${year}-09-01`, // Constitution Day
        `${year}-09-15`, // Our Lady of Sorrows
        `${year}-11-01`, // All Saints
        `${year}-11-17`, // Struggle for Freedom Day
        `${year}-12-24`, // Christmas Eve
        `${year}-12-25`, // Christmas
        `${year}-12-26`, // Second Christmas Day
      ];
    },
  },
  // === North America ===
  CA: {
    name: "Canada",
    getHolidays: (year) => {
      const easter = getEasterSunday(year);
      const familyDay = getNthWeekdayOfMonth(year, 1, 1, 3); // Third Monday of February
      const labourDay = getNthWeekdayOfMonth(year, 8, 1, 1); // First Monday of September
      const thanksgiving = getNthWeekdayOfMonth(year, 9, 1, 2); // Second Monday of October

      // Victoria Day is the Monday on or before May 24
      let victoriaDay = new Date(year, 4, 24);
      while (victoriaDay.getDay() !== 1) victoriaDay.setDate(victoriaDay.getDate() - 1);

      const holidays = [
        `${year}-01-01`, // New Year's Day
        formatDate(familyDay), // Family Day
        formatDate(addDays(easter, -2)), // Good Friday
        formatDate(victoriaDay), // Victoria Day
        `${year}-07-01`, // Canada Day
        formatDate(getNthWeekdayOfMonth(year, 7, 1, 1)), // Civic Holiday (first Monday of August)
        formatDate(labourDay), // Labour Day
        formatDate(thanksgiving), // Thanksgiving
        `${year}-11-11`, // Remembrance Day
        `${year}-12-25`, // Christmas
        `${year}-12-26`, // Boxing Day
      ];

      // Handle Canada Day substitute
      const canadaDay = new Date(year, 6, 1);
      if (canadaDay.getDay() === 0) {
        holidays.push(`${year}-07-02`);
      }

      return holidays;
    },
  },
  US: {
    name: "United States",
    getHolidays: (year) => {
      const mlkDay = getNthWeekdayOfMonth(year, 0, 1, 3); // Third Monday of January
      const presidentsDay = getNthWeekdayOfMonth(year, 1, 1, 3); // Third Monday of February
      const memorialDay = getNthWeekdayOfMonth(year, 4, 1, -1); // Last Monday of May
      const laborDay = getNthWeekdayOfMonth(year, 8, 1, 1); // First Monday of September
      const columbusDay = getNthWeekdayOfMonth(year, 9, 1, 2); // Second Monday of October
      const thanksgiving = getNthWeekdayOfMonth(year, 10, 4, 4); // Fourth Thursday of November

      const holidays = [
        `${year}-01-01`, // New Year's Day
        formatDate(mlkDay), // MLK Day
        formatDate(presidentsDay), // Presidents Day
        formatDate(memorialDay), // Memorial Day
        `${year}-06-19`, // Juneteenth
        `${year}-07-04`, // Independence Day
        formatDate(laborDay), // Labor Day
        formatDate(columbusDay), // Columbus Day
        `${year}-11-11`, // Veterans Day
        formatDate(thanksgiving), // Thanksgiving
        `${year}-12-25`, // Christmas
      ];

      // Handle July 4th substitute (observed on Friday if Saturday, Monday if Sunday)
      const july4 = new Date(year, 6, 4);
      if (july4.getDay() === 6) {
        holidays.push(`${year}-07-03`);
      } else if (july4.getDay() === 0) {
        holidays.push(`${year}-07-05`);
      }

      return holidays;
    },
  },
  // === Oceania ===
  AU: {
    name: "Australia",
    getHolidays: (year) => {
      const easter = getEasterSunday(year);
      const queensBirthday = getNthWeekdayOfMonth(year, 5, 1, 2); // Second Monday of June

      // Australia Day - Jan 26 or next Monday if weekend
      let ausDay = new Date(year, 0, 26);
      if (ausDay.getDay() === 0) ausDay = new Date(year, 0, 27);
      else if (ausDay.getDay() === 6) ausDay = new Date(year, 0, 28);

      // ANZAC Day - April 25 (no substitute for weekend in most states)
      const holidays = [
        `${year}-01-01`, // New Year's Day
        formatDate(ausDay), // Australia Day
        formatDate(addDays(easter, -2)), // Good Friday
        formatDate(addDays(easter, 1)), // Easter Monday
        `${year}-04-25`, // ANZAC Day
        formatDate(queensBirthday), // Queen's Birthday
        `${year}-12-25`, // Christmas
        `${year}-12-26`, // Boxing Day
      ];

      // Handle Christmas/Boxing Day substitutes
      const christmas = new Date(year, 11, 25);
      if (christmas.getDay() === 0) {
        holidays.push(`${year}-12-27`);
      } else if (christmas.getDay() === 6) {
        holidays.push(`${year}-12-27`);
        holidays.push(`${year}-12-28`);
      }

      return holidays;
    },
  },
  NZ: {
    name: "New Zealand",
    getHolidays: (year) => {
      const easter = getEasterSunday(year);
      const queensBirthday = getNthWeekdayOfMonth(year, 5, 1, 1); // First Monday of June
      const labourDay = getNthWeekdayOfMonth(year, 9, 1, 4); // Fourth Monday of October

      // Matariki - Friday closest to first lunar month (approximate, varies)
      // For simplicity, using an approximation
      const matarikiDates = {
        2024: "2024-06-28", 2025: "2025-06-20", 2026: "2026-07-10",
        2027: "2027-06-25", 2028: "2028-07-14", 2029: "2029-07-06",
        2030: "2030-06-21",
      };

      const holidays = [
        `${year}-01-01`, // New Year's Day
        `${year}-01-02`, // Day after New Year
        `${year}-02-06`, // Waitangi Day
        formatDate(addDays(easter, -2)), // Good Friday
        formatDate(addDays(easter, 1)), // Easter Monday
        `${year}-04-25`, // ANZAC Day
        formatDate(queensBirthday), // Queen's Birthday
        matarikiDates[year] || `${year}-06-20`, // Matariki (approximate)
        formatDate(labourDay), // Labour Day
        `${year}-12-25`, // Christmas
        `${year}-12-26`, // Boxing Day
      ];

      // Handle substitute days
      const christmas = new Date(year, 11, 25);
      if (christmas.getDay() === 0) {
        holidays.push(`${year}-12-27`);
      } else if (christmas.getDay() === 6) {
        holidays.push(`${year}-12-27`);
        holidays.push(`${year}-12-28`);
      }

      return holidays;
    },
  },
};

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Get holidays for a country and year (dynamically calculated)
 */
export function getHolidaysForYear(countryCode, year) {
  const country = HOLIDAY_DEFINITIONS[countryCode];
  if (!country || !country.getHolidays) return [];
  return country.getHolidays(year).sort();
}

/**
 * Get bank holidays data structure compatible with the UI
 * Generates holidays dynamically for current and next year
 */
export function getBankHolidays() {
  const result = {};

  for (const [code, def] of Object.entries(HOLIDAY_DEFINITIONS)) {
    result[code] = {
      name: def.name,
      // Generate holidays for current year, next year, and year after
      getHolidaysForYear: (year) => getHolidaysForYear(code, year),
    };
  }

  return result;
}
