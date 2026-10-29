# Registra el sparse package del Compañero para desarrollo.
#
# Windows 10 no da identidad a un sparse package registrado sin firmar, así que el script:
#   1. Crea (una sola vez) un certificado de prueba CN=IslaDev en el almacén del usuario.
#   2. Lo marca como de confianza en LocalMachine\TrustedPeople (solo la primera vez; pide administrador).
#   3. Empaqueta src-tauri\paquete en un .msix, lo firma y lo instala apuntando al ejecutable.
#
# Requisitos: Modo de desarrollador activado y Windows SDK (makeappx.exe y signtool.exe).
# Uso: powershell -ExecutionPolicy Bypass -File scripts\register-dev.ps1 [-Perfil debug|release]
param(
    [ValidateSet('debug', 'release')]
    [string]$Perfil = 'debug'
)
$ErrorActionPreference = 'Stop'

$raiz = Split-Path -Parent $PSScriptRoot
$carpetaPaquete = Join-Path $raiz 'src-tauri\paquete'
$carpetaExe = Join-Path $raiz "src-tauri\target\$Perfil"
$carpetaSalida = Join-Path $raiz 'src-tauri\target\paquete'
$msix = Join-Path $carpetaSalida 'companero-dev.msix'
$sujeto = 'CN=IslaDev' # Debe coincidir con Publisher del AppxManifest.xml

if (-not (Test-Path (Join-Path $carpetaExe 'isla.exe'))) {
    throw "No existe $carpetaExe\isla.exe. Compila antes con 'npm run tauri dev' (debug) o 'npm run tauri build' (release)."
}

# --- Herramientas del Windows SDK (la versión más reciente instalada) ---
function Buscar-Herramienta([string]$nombre) {
    $encontrada = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Recurse -Filter $nombre -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '\\x64\\' } |
        Sort-Object FullName -Descending |
        Select-Object -First 1
    if (-not $encontrada) { throw "No se encontró $nombre. Instala el Windows SDK." }
    $encontrada.FullName
}
$makeappx = Buscar-Herramienta 'makeappx.exe'
$signtool = Buscar-Herramienta 'signtool.exe'

# --- 1. Certificado de prueba ---
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $sujeto -and $_.FriendlyName -eq 'Isla (desarrollo)' } | Select-Object -First 1
if (-not $cert) {
    Write-Host "Creando certificado de prueba $sujeto"
    $cert = New-SelfSignedCertificate -Type Custom -Subject $sujeto `
        -KeyUsage DigitalSignature -FriendlyName 'Isla (desarrollo)' `
        -CertStoreLocation Cert:\CurrentUser\My `
        -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
}

# --- 2. Confianza en el certificado (necesita administrador la primera vez) ---
$confiado = Test-Path "Cert:\LocalMachine\TrustedPeople\$($cert.Thumbprint)"
if (-not $confiado) {
    $esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $esAdmin) {
        throw "La primera vez hay que confiar en el certificado de prueba. Abre PowerShell como administrador y ejecuta este mismo script."
    }
    Write-Host 'Añadiendo el certificado a LocalMachine\TrustedPeople'
    $cer = Join-Path $env:TEMP 'isla-dev.cer'
    Export-Certificate -Cert $cert -FilePath $cer | Out-Null
    Import-Certificate -FilePath $cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null
    Remove-Item $cer
}

# --- 3. Empaquetar y firmar ---
New-Item -ItemType Directory -Force $carpetaSalida | Out-Null
if (Test-Path $msix) { Remove-Item $msix }
# /nv: sin validar, porque isla.exe está fuera del paquete (en -ExternalLocation)
& $makeappx pack /o /nv /d $carpetaPaquete /p $msix | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'makeappx no pudo crear el paquete.' }
& $signtool sign /q /fd SHA256 /sha1 $cert.Thumbprint /s My $msix
if ($LASTEXITCODE -ne 0) { throw 'signtool no pudo firmar el paquete.' }

# --- 4. Instalar apuntando a la carpeta del ejecutable ---
# Windows resuelve las rutas del manifiesto (logos) desde la carpeta externa:
# si Assets no está junto a isla.exe, el exe arranca sin identidad.
Copy-Item -Recurse -Force (Join-Path $carpetaPaquete 'Assets') $carpetaExe

$previo = Get-AppxPackage -Name 'IsbarCompaneroDev'
if ($previo) {
    Write-Host "Quitando el registro anterior: $($previo.PackageFullName)"
    Remove-AppxPackage -Package $previo.PackageFullName
}
Write-Host "Instalando el paquete con el ejecutable de $carpetaExe"
Add-AppxPackage -Path $msix -ExternalLocation $carpetaExe

Get-AppxPackage -Name 'IsbarCompaneroDev' | Format-List Name, PackageFullName, InstallLocation
Write-Host 'Listo. Cierra y vuelve a abrir la isla para que arranque con identidad de paquete.'
