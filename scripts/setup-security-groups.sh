#!/bin/bash
# Run in AWS CloudShell (us-east-2 region)
# Configures all Security Group rules for the distributed traffic platform

set -e
REGION="us-east-2"

echo "=== Fetching Security Group IDs from instance IDs ==="

SG_KAFKA=$(aws ec2 describe-instances --region $REGION \
  --instance-ids i-024ea3157e031a443 \
  --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' \
  --output text)

SG_PROCESSOR=$(aws ec2 describe-instances --region $REGION \
  --instance-ids i-05ace6c5c5e7db318 \
  --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' \
  --output text)

SG_BACKEND1=$(aws ec2 describe-instances --region $REGION \
  --instance-ids i-08c149cab77ac564a \
  --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' \
  --output text)

SG_BACKEND2=$(aws ec2 describe-instances --region $REGION \
  --instance-ids i-0884f00806fe0fe93 \
  --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' \
  --output text)

SG_NGINX=$(aws ec2 describe-instances --region $REGION \
  --instance-ids i-0b7c9d0881d99b96e \
  --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' \
  --output text)

SG_STAGING=$(aws ec2 describe-instances --region $REGION \
  --instance-ids i-0fceefb99c1c2ff3a \
  --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' \
  --output text)

echo "kafka-broker  SG: $SG_KAFKA"
echo "processor     SG: $SG_PROCESSOR"
echo "api-backend-1 SG: $SG_BACKEND1"
echo "api-backend-2 SG: $SG_BACKEND2"
echo "nginx-proxy   SG: $SG_NGINX"
echo "staging       SG: $SG_STAGING"
echo ""

add_rule() {
  local sg=$1 port=$2 proto=${3:-tcp} cidr=${4:-172.31.0.0/16}
  aws ec2 authorize-security-group-ingress \
    --region $REGION \
    --group-id $sg \
    --protocol $proto \
    --port $port \
    --cidr $cidr 2>&1 | grep -v "already exists" || true
  echo "  + $sg port=$port proto=$proto from=$cidr"
}

# ── kafka-broker: port 9092 from all VPC instances ──────────────────
echo "=== kafka-broker ==="
add_rule $SG_KAFKA 9092

# ── traffic-processor: PostgreSQL from VPC ──────────────────────────
echo "=== traffic-processor ==="
add_rule $SG_PROCESSOR 5432

# ── api-backend-1: port 3000 from nginx-proxy only ──────────────────
echo "=== api-backend-1 ==="
add_rule $SG_BACKEND1 3000 tcp 172.31.41.121/32

# ── api-backend-2: port 3000 from nginx-proxy only ──────────────────
echo "=== api-backend-2 ==="
add_rule $SG_BACKEND2 3000 tcp 172.31.41.121/32

# ── nginx-proxy: HTTP + HTTPS from internet ──────────────────────────
echo "=== nginx-proxy ==="
add_rule $SG_NGINX 80  tcp 0.0.0.0/0
add_rule $SG_NGINX 443 tcp 0.0.0.0/0

echo ""
echo "=== Done. Current inbound rules ==="
for sg in $SG_KAFKA $SG_PROCESSOR $SG_BACKEND1 $SG_BACKEND2 $SG_NGINX; do
  echo ""
  echo "SG: $sg"
  aws ec2 describe-security-groups --region $REGION --group-ids $sg \
    --query 'SecurityGroups[0].IpPermissions[*].[IpProtocol,FromPort,IpRanges[0].CidrIp]' \
    --output table
done
