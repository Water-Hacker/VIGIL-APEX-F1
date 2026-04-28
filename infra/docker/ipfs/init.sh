#!/usr/bin/env sh
# IPFS init — applied on first container start.
set -e
ipfs config Datastore.StorageMax 50GB
ipfs config Routing.Type dhtclient
ipfs config Addresses.API /ip4/0.0.0.0/tcp/5001
ipfs config Addresses.Gateway /ip4/0.0.0.0/tcp/8080
# Restrict gateway to local — never expose to the public.
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["*"]'
ipfs config --json Reprovider.Strategy '"pinned"'
