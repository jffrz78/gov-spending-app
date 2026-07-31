const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function zonedDateParts(now: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );

  if (!values.year || !values.month || !values.day) {
    throw new Error(`Could not calculate the current date in ${timeZone}.`);
  }

  return {
    year: values.year,
    month: values.month,
    day: values.day
  };
}

export function previousCalendarDate(
  now = new Date(),
  timeZone = "America/New_York"
): string {
  const { year, month, day } = zonedDateParts(now, timeZone);
  const previous = new Date(Date.UTC(year, month - 1, day) - 86_400_000);
  return previous.toISOString().slice(0, 10);
}

export function assertIsoDate(value: string): string {
  if (!ISO_DATE.test(value)) {
    throw new Error(`Invalid date "${value}". Expected YYYY-MM-DD.`);
  }

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const canonical = parsed.toISOString().slice(0, 10);

  if (canonical !== value) {
    throw new Error(`Invalid calendar date "${value}".`);
  }

  return value;
}
