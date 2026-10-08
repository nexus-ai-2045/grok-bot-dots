export class BridgeError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
