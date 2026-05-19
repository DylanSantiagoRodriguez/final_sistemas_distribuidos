#!/bin/bash
# Run on kafka-broker VM after Kafka is up
# Usage: KAFKA_BROKER=localhost:9092 ./setup-kafka-topics.sh

BROKER="${KAFKA_BROKER:-localhost:9092}"

create_topic() {
  kafka-topics.sh --create \
    --if-not-exists \
    --topic "$1" \
    --partitions "${2:-4}" \
    --replication-factor 1 \
    --bootstrap-server "$BROKER"
}

echo "Creating zone topics..."
create_topic trafico.norte      4
create_topic trafico.sur        4
create_topic trafico.centro     4
create_topic trafico.periferico 4

echo "Creating sensor-type topics..."
create_topic sensor.camara   4
create_topic sensor.contador 4
create_topic sensor.semaforo 4

echo "Creating admin alert topic..."
create_topic alertas.admin 1

echo "Done. Listing topics:"
kafka-topics.sh --list --bootstrap-server "$BROKER"
