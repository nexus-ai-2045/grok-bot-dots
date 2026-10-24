const ALLOWED = [
  "event",
  "code",
  "httpStatus",
  "byte_length",
  "correlation_id",
  "event_id",
  "hop",
  "duplicate",
  "mode",
  "transport_invoked",
];

export function createLogger(sink = []) {
  return {
    sink,
    log(fields) {
      const safe = Object.create(null);
      for (const key of ALLOWED) {
        if (fields != null && fields[key] !== undefined) safe[key] = fields[key];
      }
      sink.push(safe);
      if (sink.length > 200) sink.shift();
      return safe;
    },
  };
}
