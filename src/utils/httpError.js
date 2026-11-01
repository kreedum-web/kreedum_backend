/** An error the API returns as it is: HTTP status + optional code for the website. */
class HttpError extends Error {
  constructor(status, message, code, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

module.exports = HttpError;
