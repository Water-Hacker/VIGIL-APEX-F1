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
