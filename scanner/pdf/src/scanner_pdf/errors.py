"""Scanner errors with a stable code (what an integrator reads, not the message)."""


class ScannerError(Exception):
    """Expected error. `code` is stable and suitable to show or translate in the UI."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    def to_dict(self) -> dict:
        return {"code": self.code, "message": self.message}
