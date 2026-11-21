"""Errores del escáner con un código estable (lo que lee quien integra, no el mensaje)."""


class ErrorEscaner(Exception):
    """Error controlado. `codigo` es estable y apto para mostrar/traducir en la UI."""

    def __init__(self, codigo: str, mensaje: str):
        super().__init__(mensaje)
        self.codigo = codigo
        self.mensaje = mensaje

    def a_dict(self) -> dict:
        return {"codigo": self.codigo, "mensaje": self.mensaje}
