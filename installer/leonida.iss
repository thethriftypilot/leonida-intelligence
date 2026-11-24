; Inno Setup script for Leonida Intelligence. Build with installer\build.ps1, which stages the
; files and passes AppVersion and StageDir.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef StageDir
  #define StageDir "..\build\stage"
#endif
#define AppName "Leonida Intelligence"
#define AppExe "Leonida.exe"
#define RepoUrl "https://github.com/thethriftypilot/leonida-intelligence"

[Setup]
AppId={{6E1F4C52-8B7A-4D0E-9C3B-2F5A7D91E4B8}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=TheThriftyPilot
AppPublisherURL={#RepoUrl}
AppSupportURL={#RepoUrl}/issues
AppUpdatesURL={#RepoUrl}/releases
AppComments=Unofficial GTA VI map companion for your home network
VersionInfoVersion={#AppVersion}.0
VersionInfoDescription={#AppName} Setup
; Per-user install: no admin rights needed, except one optional prompt for the firewall rule.
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\{#AppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
WizardStyle=modern
SetupIconFile=leonida.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
OutputBaseFilename=LeonidaIntelligence-Setup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
CloseApplications=yes
RestartApplications=no

[Messages]
WelcomeLabel2=This will install [name/ver] on your computer.%n%nIt's an unofficial, fan-made GTA VI map and progress tracker. It runs on this PC, and you can open it from your phone, tablet or other computers at home.%n%nAfter installing, it downloads the map (about 130 MB) from the GTADB community project.
FinishedLabel=[name] is installed.%n%nIt runs quietly in the notification area next to the clock. Click its icon to open the map, or right-click it and choose "Open on my phone or tablet" for the address to use on your other devices.

[Tasks]
Name: firewall; Description: "Let my phone, tablet and other devices on my home network open the map (Windows will ask for permission once)"
Name: autostart; Description: "Start {#AppName} when I sign in to Windows"
Name: desktopicon; Description: "Create a desktop shortcut"; Flags: unchecked

[InstallDelete]
; Replace the program files completely on upgrade. Your data lives elsewhere (see [Code]).
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\runtime"
Type: filesandordirs; Name: "{app}\git"
Type: filesandordirs; Name: "{app}\tools"

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; Comment: "Open the Leonida map"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Comment: "Open the Leonida map"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\{#AppName}"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "{#AppName}"; ValueData: """{app}\{#AppExe}"" --background"; Tasks: autostart; Flags: uninsdeletevalue

[Run]
Filename: "{app}\{#AppExe}"; Parameters: "--download-map --if-missing"; StatusMsg: "Downloading the map..."; BeforeInstall: AddFirewallRule; Flags: waituntilterminated skipifsilent
Filename: "{app}\{#AppExe}"; Parameters: "--background"; Flags: nowait; Check: WizardSilent
Filename: "{app}\{#AppExe}"; Description: "Open {#AppName} now"; Flags: postinstall nowait skipifsilent

[Code]
const
  FirewallGroup = 'Leonida Intelligence';
  RunKey = 'Software\Microsoft\Windows\CurrentVersion\Run';

function PowerShellExe: String;
begin
  Result := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
end;

function FirewallRuleExists: Boolean;
var
  rc: Integer;
begin
  Result := False;
  if Exec(PowerShellExe, '-NoProfile -NonInteractive -Command "if (Get-NetFirewallRule -Group ''' + FirewallGroup + ''' -ErrorAction SilentlyContinue) { exit 3 } else { exit 0 }"',
          '', SW_HIDE, ewWaitUntilTerminated, rc) then
    Result := (rc = 3);
end;

function RunNetworkTool(Params: String): Boolean;
var
  rc: Integer;
begin
  Result := ShellExec('runas', PowerShellExe,
    '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\tools\network.ps1') + '" ' + Params,
    '', SW_HIDE, ewWaitUntilTerminated, rc);
  Result := Result and (rc = 0);
end;

procedure AddFirewallRule;
begin
  if not WizardIsTaskSelected('firewall') then exit;
  if FirewallRuleExists then exit;
  WizardForm.StatusLabel.Caption := 'Allowing devices on your home network (Windows will ask for permission)...';
  if not RunNetworkTool('-AddFirewall -Program "' + ExpandConstant('{app}\runtime\node.exe') + '"') then
    Log('Firewall rule was not added (declined or failed). It can be added later from the tray app.');
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  rc: Integer;
  exe: String;
begin
  Result := '';
  // Stop a running copy so its files can be replaced.
  exe := ExpandConstant('{app}\Leonida.exe');
  if FileExists(exe) then
    Exec(exe, '--quit', '', SW_HIDE, ewWaitUntilTerminated, rc);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  rc: Integer;
  home: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    Exec(ExpandConstant('{app}\Leonida.exe'), '--quit', '', SW_HIDE, ewWaitUntilTerminated, rc);
    RegDeleteValue(HKCU, RunKey, 'Leonida Intelligence');
    if FirewallRuleExists then
      RunNetworkTool('-RemoveFirewall');
  end;
  if (CurUninstallStep = usPostUninstall) and (not UninstallSilent) then
  begin
    home := ExpandConstant('{localappdata}\Leonida Intelligence');
    if DirExists(home) then
      if MsgBox('Also delete your progress, notes, backups and the downloaded map?' + #13#10#13#10 +
                'Choose No to keep them for a future reinstall. They are in:' + #13#10 + home,
                mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(home, True, True, True);
  end;
end;
