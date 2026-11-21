"""escaner_pdf: imagen PNG de un documento -> PDF buscable (imagen fiel + capa OCR invisible).

Uso mínimo:
    from escaner_pdf import convertir, Opciones
    r = convertir("captura.png", "salida/")
    if r.ok: print(r.pdf)
"""

from .errores import ErrorEscaner
from .pipeline import Opciones, Resultado, convertir

__all__ = ["convertir", "Opciones", "Resultado", "ErrorEscaner"]
__version__ = "0.1.0"
