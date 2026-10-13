"""Cross-project portfolio overview (projects the caller belongs to; all for admins)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.authz import Access, get_access, memberships
from app.db import get_db
from app.schemas.portfolio import PortfolioOut
from app.services.portfolio import build_portfolio

router = APIRouter()


@router.get("/portfolio", response_model=PortfolioOut)
def portfolio(db: Session = Depends(get_db), access: Access = Depends(get_access)):
    return build_portfolio(db, access.user, memberships(db, access.user))
