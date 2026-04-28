{{- define "regional-node.name" -}}
{{- printf "vigil-region-%s" (.Values.region.code | lower) -}}
{{- end -}}

{{- define "regional-node.componentName" -}}
{{- printf "%s-%s" (include "regional-node.name" .root) .component -}}
{{- end -}}

{{- define "regional-node.labels" -}}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/part-of: vigil-apex-federation
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
vigil-apex.cm/region-code: {{ .Values.region.code | quote }}
vigil-apex.cm/region-name: {{ .Values.region.name | quote }}
vigil-apex.cm/phase: "3"
{{- end -}}

{{- define "regional-node.componentLabels" -}}
{{- include "regional-node.labels" .root }}
app.kubernetes.io/name: {{ .component }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "regional-node.componentSelector" -}}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/name: {{ .component }}
{{- end -}}

{{- define "regional-node.image" -}}
{{- $image := .image -}}
{{- $tag := default "0.1.0" $image.tag -}}
{{- if regexMatch "^[^/]+\\.[^/]+/" $image.repository -}}
{{- printf "%s:%s" $image.repository $tag -}}
{{- else -}}
{{- printf "%s/%s:%s" .root.Values.global.imageRegistry $image.repository $tag -}}
{{- end -}}
{{- end -}}

{{- define "regional-node.podSecurity" -}}
runAsNonRoot: true
runAsUser: 1000
runAsGroup: 1000
fsGroup: 1000
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{- define "regional-node.containerSecurity" -}}
allowPrivilegeEscalation: false
runAsNonRoot: true
runAsUser: 1000
runAsGroup: 1000
capabilities:
  drop: ["ALL"]
seccompProfile:
  type: RuntimeDefault
{{- end -}}
