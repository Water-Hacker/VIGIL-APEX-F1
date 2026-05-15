{{/*
VIGIL APEX Helm helpers — common labels, names, image refs.
Mirrors the Bitnami / common-chart conventions so anyone landing in
this chart cold can read the templates without surprise.
*/}}

{{- define "vigil-apex.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "vigil-apex.fullname" -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if .Values.fullnameOverride -}}
  {{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
  {{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "vigil-apex.componentName" -}}
{{- printf "%s-%s" (include "vigil-apex.fullname" .root) .component | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "vigil-apex.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/part-of: vigil-apex
vigil-apex.cm/cluster-region: {{ .Values.global.clusterRegion }}
{{- end -}}

{{- define "vigil-apex.componentLabels" -}}
{{- $root := .root }}
{{- include "vigil-apex.labels" $root }}
app.kubernetes.io/name: {{ .component }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "vigil-apex.componentSelector" -}}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/name: {{ .component }}
{{- end -}}

{{/*
Image reference. Components pass `.image.repository` + `.image.tag`;
fall back to `.Values.global.imageTag` when the component leaves it
empty. Repository may be absolute (with registry) or relative — when
relative we prefix `.Values.global.imageRegistry`.
*/}}
{{- define "vigil-apex.image" -}}
{{- $image := .image -}}
{{- $tag := default .root.Values.global.imageTag $image.tag -}}
{{- if hasPrefix "/" $image.repository -}}
{{- printf "%s%s:%s" .root.Values.global.imageRegistry $image.repository $tag -}}
{{- else if regexMatch "^[^/]+\\.[^/]+/" $image.repository -}}
{{- printf "%s:%s" $image.repository $tag -}}
{{- else -}}
{{- printf "%s/%s:%s" .root.Values.global.imageRegistry $image.repository $tag -}}
{{- end -}}
{{- end -}}

{{/*
Standard `securityContext` block applied to every container in the
chart. PodSecurityStandards `restricted` requires non-root + no
privilege escalation + read-only root FS. Workers that need a
writable area mount an emptyDir at /tmp.
*/}}
{{- define "vigil-apex.containerSecurityContext" -}}
allowPrivilegeEscalation: false
runAsNonRoot: true
runAsUser: 1000
runAsGroup: 1000
capabilities:
  drop: ["ALL"]
readOnlyRootFilesystem: true
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{- define "vigil-apex.podSecurityContext" -}}
runAsNonRoot: true
runAsUser: 1000
runAsGroup: 1000
fsGroup: 1000
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{/*
DL380 Gen11 cluster: pod-anti-affinity on the per-node label so two
replicas of the same component never share a node. Used by every
multi-replica StatefulSet / Deployment in HA mode.
*/}}
{{- define "vigil-apex.antiAffinity" -}}
{{- $component := .component -}}
podAntiAffinity:
  requiredDuringSchedulingIgnoredDuringExecution:
    - labelSelector:
        matchLabels:
          app.kubernetes.io/name: {{ $component }}
          app.kubernetes.io/instance: {{ .root.Release.Name }}
      topologyKey: vigil.cluster/node
{{- end -}}

{{/*
Pin a workload to a specific cluster node (a, b, or c). For singleton
services with persistent host-local data (Neo4j on B, Tor on A,
Prometheus on C).
*/}}
{{- define "vigil-apex.pinToNode" -}}
nodeAffinity:
  requiredDuringSchedulingIgnoredDuringExecution:
    nodeSelectorTerms:
      - matchExpressions:
          - key: vigil.cluster/node
            operator: In
            values: [ {{ .node | quote }} ]
{{- end -}}

{{/*
Topology spread for multi-replica deployments — soft constraint
(ScheduleAnyway) so workers can still come up if a node is briefly
unavailable, but skew is minimised.
*/}}
{{- define "vigil-apex.topologySpread" -}}
{{- $component := .component -}}
- maxSkew: 1
  topologyKey: vigil.cluster/node
  whenUnsatisfiable: ScheduleAnyway
  labelSelector:
    matchLabels:
      app.kubernetes.io/name: {{ $component }}
      app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end -}}

{{/*
Standard liveness + readiness probe pattern for HTTP services.
Use:
  {{- include "vigil-apex.httpProbes" (dict "port" 8080 "path" "/healthz") | nindent 10 }}
*/}}
{{- define "vigil-apex.httpProbes" -}}
livenessProbe:
  httpGet:
    path: {{ .path }}
    port: {{ .port }}
  initialDelaySeconds: 30
  periodSeconds: 15
  timeoutSeconds: 5
  failureThreshold: 3
readinessProbe:
  httpGet:
    path: {{ .path }}
    port: {{ .port }}
  initialDelaySeconds: 5
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 2
{{- end -}}

{{/*
Standard liveness + readiness probe pattern for TCP services.
*/}}
{{- define "vigil-apex.tcpProbes" -}}
livenessProbe:
  tcpSocket:
    port: {{ .port }}
  initialDelaySeconds: 30
  periodSeconds: 15
  timeoutSeconds: 5
  failureThreshold: 3
readinessProbe:
  tcpSocket:
    port: {{ .port }}
  initialDelaySeconds: 5
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 2
{{- end -}}
