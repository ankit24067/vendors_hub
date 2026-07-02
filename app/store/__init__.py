from config import Config

_store = None


def get_store():
    global _store
    if _store is None:
        if Config.MOCK_MODE:
            from app.store.mock import MockStore

            _store = MockStore()
        else:
            from app.store.sheets import SheetsStore

            _store = SheetsStore()
    return _store
