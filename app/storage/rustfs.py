"""RustFS (S3-compatible) object storage wrapper for report artifacts."""
from __future__ import annotations

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from app.config import settings


def _client():
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def ensure_bucket() -> None:
    """Create the configured bucket if it does not exist. Safe to call repeatedly."""
    client = _client()
    try:
        client.head_bucket(Bucket=settings.s3_bucket)
    except ClientError:
        client.create_bucket(Bucket=settings.s3_bucket)


def put_object(key: str, data: bytes, content_type: str) -> str:
    client = _client()
    client.put_object(
        Bucket=settings.s3_bucket, Key=key, Body=data, ContentType=content_type
    )
    return key


def get_object(key: str) -> bytes:
    client = _client()
    obj = client.get_object(Bucket=settings.s3_bucket, Key=key)
    return obj["Body"].read()


def delete_object(key: str) -> None:
    client = _client()
    client.delete_object(Bucket=settings.s3_bucket, Key=key)


def presigned_url(key: str, expires: int = 3600, download_name: str | None = None) -> str:
    client = _client()
    params = {"Bucket": settings.s3_bucket, "Key": key}
    if download_name:
        params["ResponseContentDisposition"] = f'attachment; filename="{download_name}"'
    return client.generate_presigned_url("get_object", Params=params, ExpiresIn=expires)
