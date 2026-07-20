import React from "react";

const h = React.createElement;

export function TelegramConsole() {
  return h(React.Fragment, null,
      h("main", null,
        h("section", {"id":"sign-in-view","className":"auth-shell","aria-labelledby":"sign-in-title"},
          h("div", {"className":"auth-showcase","aria-hidden":"true"},
            h("div", {"className":"auth-brand"},
              h("span", {"className":"auth-brand-mark"},
                h("svg", {"viewBox":"0 0 24 24","aria-hidden":"true"},
                  h("path", {"d":"M21.6 3.2 18.7 20c-.2 1.2-.9 1.5-1.9.9l-4.4-3.3-2.1 2c-.2.2-.4.4-.9.4l.3-4.5L18 8c.4-.3-.1-.5-.6-.2L7.1 14.3l-4.4-1.4c-1-.3-1-1 .2-1.5L20.2 2.8c.8-.3 1.5.2 1.4.4Z"})
                )
              ),
              h("span", null,
                "AgenticThat"
              )
            ),
            h("div", {"className":"auth-message"},
              h("p", {"className":"eyebrow"},
                "Chat Workflow Automation"
              ),
              h("h2", null,
                "Telegram operations,",
                h("br", null),
                "without the operational clutter."
              ),
              h("p", null,
                "One focused workspace for teams to manage conversations, audiences, and publishing with clarity."
              )
            ),
            h("div", {"className":"auth-proof"},
              h("span", null,
                "Secure access"
              ),
              h("span", null,
                "Team-ready workspace"
              ),
              h("span", null,
                "Telegram native"
              )
            )
          ),
          h("div", {"className":"auth-card"},
            h("div", {"className":"auth-card-heading"},
              h("span", {"className":"mobile-auth-mark","aria-hidden":"true"},
                h("svg", {"viewBox":"0 0 24 24"},
                  h("path", {"d":"M21.6 3.2 18.7 20c-.2 1.2-.9 1.5-1.9.9l-4.4-3.3-2.1 2c-.2.2-.4.4-.9.4l.3-4.5L18 8c.4-.3-.1-.5-.6-.2L7.1 14.3l-4.4-1.4c-1-.3-1-1 .2-1.5L20.2 2.8c.8-.3 1.5.2 1.4.4Z"})
                )
              ),
              h("p", {"className":"eyebrow"},
                "Secure workspace"
              ),
              h("h1", {"id":"sign-in-title"},
                "Welcome back"
              ),
              h("p", {"className":"lede"},
                "Sign in to continue to your Telegram workspace."
              )
            ),
            h("form", {"id":"password-sign-in-form","className":"stack","noValidate":true},
              h("label", {"htmlFor":"username"},
                "Username"
              ),
              h("input", {"id":"username","name":"username","type":"text","autoComplete":"username","required":true}),
              h("label", {"htmlFor":"login-password"},
                "Password"
              ),
              h("input", {"id":"login-password","name":"password","type":"password","autoComplete":"current-password","required":true}),
              h("label", {"htmlFor":"display-name"},
                "Display name"
              ),
              h("input", {"id":"display-name","name":"displayName","type":"text","autoComplete":"name","placeholder":"Only needed when creating an account"}),
              h("div", {"className":"button-row"},
                h("button", {"className":"button primary","type":"submit"},
                  "Sign in"
                ),
                h("button", {"id":"create-account","className":"button ghost","type":"button"},
                  "Create workspace"
                )
              )
            ),
            h("details", {"className":"token-panel"},
              h("summary", null,
                "Access token sign-in"
              ),
              h("form", {"id":"token-sign-in-form","className":"stack compact","noValidate":true},
                h("label", {"htmlFor":"access-token"},
                  "Access token"
                ),
                h("input", {"id":"access-token","name":"accessToken","type":"password","autoComplete":"off","spellCheck":false}),
                h("button", {"className":"button ghost","type":"submit"},
                  "Use token"
                )
              )
            ),
            h("p", {"id":"sign-in-status","className":"status","role":"status","aria-live":"polite"})
          )
        ),
        h("section", {"id":"workspace","className":"app-shell","hidden":true},
          h("aside", {"className":"sidebar","aria-label":"Workflow navigation"},
            h("svg", {"className":"icon-sprite","aria-hidden":"true"},
              h("symbol", {"id":"nav-overview","viewBox":"0 0 24 24"},
                h("path", {"d":"M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z"})
              ),
              h("symbol", {"id":"nav-inbox","viewBox":"0 0 24 24"},
                h("path", {"d":"M4 5h16v12H7l-3 3V5Zm3 4h10M7 13h7"})
              ),
              h("symbol", {"id":"nav-contacts","viewBox":"0 0 24 24"},
                h("path", {"d":"M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-1v6m3-3h-6"})
              ),
              h("symbol", {"id":"nav-groups","viewBox":"0 0 24 24"},
                h("path", {"d":"M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-5a3 3 0 0 1 0 6m5 9v-2a4 4 0 0 0-3-3.9"})
              ),
              h("symbol", {"id":"nav-channels","viewBox":"0 0 24 24"},
                h("path", {"d":"m4 13 13-6v10L4 13Zm0 0v5m4-3 2 5"})
              ),
              h("symbol", {"id":"nav-compose","viewBox":"0 0 24 24"},
                h("path", {"d":"M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5Z"})
              ),
              h("symbol", {"id":"nav-history","viewBox":"0 0 24 24"},
                h("path", {"d":"M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5m4-1v5l3 2"})
              ),
              h("symbol", {"id":"nav-connect","viewBox":"0 0 24 24"},
                h("path", {"d":"M15 7h2a4 4 0 0 1 0 8h-2m-6 0H7a4 4 0 0 1 0-8h2m-2 5h10M12 3v5m-2-2h4"})
              ),
              h("symbol", {"id":"nav-accounts","viewBox":"0 0 24 24"},
                h("rect", {"x":"3","y":"4","width":"18","height":"16","rx":"3"}),
                h("path", {"d":"M8 9h8M8 13h5"})
              ),
              h("symbol", {"id":"nav-profile","viewBox":"0 0 24 24"},
                h("circle", {"cx":"12","cy":"8","r":"4"}),
                h("path", {"d":"M4 21a8 8 0 0 1 16 0"})
              ),
              h("symbol", {"id":"nav-search","viewBox":"0 0 24 24"},
                h("circle", {"cx":"11","cy":"11","r":"7"}),
                h("path", {"d":"m20 20-4-4"})
              ),
              h("symbol", {"id":"nav-settings","viewBox":"0 0 24 24"},
                h("circle", {"cx":"12","cy":"12","r":"3"}),
                h("path", {"d":"M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"})
              ),
              h("symbol", {"id":"nav-backup","viewBox":"0 0 24 24"},
                h("path", {"d":"M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4m4-6 4-4 4 4m-4-4v11"})
              )
            ),
            h("div", {"className":"brand"},
              h("span", {"className":"brand-mark"},
                h("svg", {"viewBox":"0 0 24 24","aria-hidden":"true"},
                  h("path", {"d":"M21.6 3.2 18.7 20c-.2 1.2-.9 1.5-1.9.9l-4.4-3.3-2.1 2c-.2.2-.4.4-.9.4l.3-4.5L18 8c.4-.3-.1-.5-.6-.2L7.1 14.3l-4.4-1.4c-1-.3-1-1 .2-1.5L20.2 2.8c.8-.3 1.5.2 1.4.4Z"})
                )
              ),
              h("div", null,
                h("strong", null,
                  "Telegram"
                ),
                h("span", null,
                  "Workflow automation"
                )
              )
            ),
            h("nav", {"className":"nav-menu"},
              h("div", {"className":"nav-section"},
                h("p", {"className":"nav-label"},
                  "Workspace"
                ),
                h("button", {"className":"nav-item active","type":"button","data-view":"dashboard"},
                  h("svg", {"className":"nav-icon"},
                    h("use", {"href":"#nav-overview"})
                  ),
                  h("span", null,
                    "Overview"
                  )
                ),
                h("button", {"className":"nav-item","type":"button","data-view":"inbox"},
                  h("svg", {"className":"nav-icon"},
                    h("use", {"href":"#nav-inbox"})
                  ),
                  h("span", null,
                    "Inbox"
                  )
                ),
                h("button", {"className":"nav-item","type":"button","data-view":"contacts"},
                  h("svg", {"className":"nav-icon"},
                    h("use", {"href":"#nav-contacts"})
                  ),
                  h("span", null,
                    "Contacts"
                  )
                )
              ),
              h("div", {"className":"nav-section"},
                h("p", {"className":"nav-label"},
                  "Engage"
                ),
                h("button", {"className":"nav-item","type":"button","data-view":"groups"},
                  h("svg", {"className":"nav-icon"},
                    h("use", {"href":"#nav-groups"})
                  ),
                  h("span", null,
                    "Groups"
                  )
                ),
                h("button", {"className":"nav-item","type":"button","data-view":"channels"},
                  h("svg", {"className":"nav-icon"},
                    h("use", {"href":"#nav-channels"})
                  ),
                  h("span", null,
                    "Channels"
                  )
                ),
                h("button", {"className":"nav-item","type":"button","data-view":"posts"},
                  h("svg", {"className":"nav-icon"},
                    h("use", {"href":"#nav-compose"})
                  ),
                  h("span", null,
                    "Create post"
                  )
                ),
                h("button", {"className":"nav-item","type":"button","data-view":"post-history"},
                  h("svg", {"className":"nav-icon"},
                    h("use", {"href":"#nav-history"})
                  ),
                  h("span", null,
                    "Delivery history"
                  )
                )
              ),
              h("div", {"className":"nav-section"},
                h("p", {"className":"nav-label"},
                  "Accounts"
                ),
                h("button", {"className":"nav-item","type":"button","data-view":"add-number"},
                  h("svg", {"className":"nav-icon"},
                    h("use", {"href":"#nav-connect"})
                  ),
                  h("span", null,
                    "Config Manager"
                  )
                ),
                h("button", {"className":"nav-item","type":"button","data-view":"manage-numbers"},
                  h("svg", {"className":"nav-icon"},
                    h("use", {"href":"#nav-accounts"})
                  ),
                  h("span", null,
                    "Connected accounts"
                  )
                ),
                h("button", {"className":"nav-item","type":"button","data-view":"profiles"},
                  h("svg", {"className":"nav-icon"},
                    h("use", {"href":"#nav-profile"})
                  ),
                  h("span", null,
                    "Profile details"
                  )
                )
              ),
              h("div", {"className":"nav-section nav-utilities"},
                h("p", {"className":"nav-label"},
                  "Workspace tools"
                ),
                h("button", {"className":"nav-item","type":"button","data-view":"search"},
                  h("svg", {"className":"nav-icon"},
                    h("use", {"href":"#nav-search"})
                  ),
                  h("span", null,
                    "Search"
                  )
                ),
                h("button", {"className":"nav-item","type":"button","data-view":"configuration"},
                  h("svg", {"className":"nav-icon"},
                    h("use", {"href":"#nav-settings"})
                  ),
                  h("span", null,
                    "Settings"
                  )
                ),
                h("button", {"className":"nav-item","type":"button","data-view":"backup"},
                  h("svg", {"className":"nav-icon"},
                    h("use", {"href":"#nav-backup"})
                  ),
                  h("span", null,
                    "Backup"
                  )
                )
              )
            )
          ),
          h("div", {"className":"main-area"},
            h("header", {"className":"topbar"},
              h("div", {"className":"topbar-title"},
                h("p", {"className":"eyebrow","id":"view-kicker"},
                  "Home"
                ),
                h("h1", {"id":"view-title"},
                  "Overview"
                )
              ),
              h("div", {"className":"top-actions"},
                h("label", {"className":"select-shell","htmlFor":"global-profile-select"},
                  h("span", null,
                    "Profile"
                  ),
                  h("select", {"id":"global-profile-select","disabled":true},
                    h("option", {"value":""},
                      "Connect a number first"
                    )
                  )
                ),
                h("button", {"id":"refresh-accounts","className":"icon-button","type":"button","title":"Refresh account list","aria-label":"Refresh account list"},
                  h("svg", {"viewBox":"0 0 24 24","aria-hidden":"true"},
                    h("path", {"d":"M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"})
                  )
                ),
                h("div", {"id":"identity","className":"identity","hidden":true},
                  h("span", {"id":"user-name"}),
                  h("button", {"id":"sign-out","className":"button ghost","type":"button"},
                    "Logout"
                  )
                )
              )
            ),
            h("section", {"id":"view-dashboard","className":"view active-view"},
              h("div", {"className":"metric-grid"},
                h("article", {"className":"metric-card"},
                  h("span", {"id":"metric-accounts"},
                    "0"
                  ),
                  h("small", null,
                    "Numbers"
                  )
                ),
                h("article", {"className":"metric-card"},
                  h("span", {"id":"metric-contacts"},
                    "0"
                  ),
                  h("small", null,
                    "Contacts"
                  )
                ),
                h("article", {"className":"metric-card"},
                  h("span", {"id":"metric-groups"},
                    "0"
                  ),
                  h("small", null,
                    "Groups"
                  )
                ),
                h("article", {"className":"metric-card"},
                  h("span", {"id":"metric-posts"},
                    "0"
                  ),
                  h("small", null,
                    "Posts"
                  )
                )
              ),
              h("div", {"className":"dashboard-grid"},
                h("section", {"className":"panel selected-profile-panel","aria-labelledby":"selected-profile-title"},
                  h("div", {"className":"panel-heading"},
                    h("div", null,
                      h("p", {"className":"eyebrow"},
                        "Selected profile"
                      ),
                      h("h2", {"id":"selected-profile-title"},
                        "Ready account"
                      )
                    ),
                    h("button", {"className":"mini-button","type":"button","data-jump":"profiles"},
                      "Edit"
                    )
                  ),
                  h("div", {"id":"selected-profile-card","className":"profile-summary"})
                ),
                h("section", {"className":"panel quick-send-panel","aria-labelledby":"quick-send-title"},
                  h("div", {"className":"panel-heading"},
                    h("div", null,
                      h("p", {"className":"eyebrow"},
                        "Manual posting"
                      ),
                      h("h2", {"id":"quick-send-title"},
                        "Quick send"
                      )
                    )
                  ),
                  h("form", {"id":"quick-send-form","className":"stack","noValidate":true},
                    h("label", {"htmlFor":"quick-recipient"},
                      "Recipient"
                    ),
                    h("input", {"id":"quick-recipient","name":"recipient","type":"text","autoComplete":"off","placeholder":"@username or existing chat","required":true}),
                    h("label", {"htmlFor":"quick-message"},
                      "Message"
                    ),
                    h("textarea", {"id":"quick-message","name":"message","rows":"4","maxLength":"4096","required":true}),
                    h("button", {"id":"quick-send-button","className":"button primary","type":"submit","disabled":true},
                      "Send from selected profile"
                    )
                  ),
                  h("p", {"id":"message-status","className":"status","role":"status","aria-live":"polite"})
                )
              ),
              h("section", {"className":"panel","aria-labelledby":"workflow-shortcuts-title"},
                h("div", {"className":"panel-heading"},
                  h("div", null,
                    h("p", {"className":"eyebrow"},
                      "Start here"
                    ),
                    h("h2", {"id":"workflow-shortcuts-title"},
                      "Quick actions"
                    )
                  )
                ),
                h("div", {"className":"shortcut-grid"},
                  h("button", {"type":"button","data-jump":"contacts"},
                    "Contact Management"
                  ),
                  h("button", {"type":"button","data-jump":"groups"},
                    "Group Management"
                  ),
                  h("button", {"type":"button","data-jump":"channels"},
                    "Channel Management"
                  ),
                  h("button", {"type":"button","data-jump":"posts"},
                    "Posting Manager"
                  )
                )
              )
            ),
            h("section", {"id":"view-add-number","className":"view","hidden":true},
              h("section", {"className":"panel connect-panel","aria-labelledby":"connect-title"},
                h("div", {"className":"panel-heading"},
                  h("div", null,
                    h("p", {"className":"eyebrow"},
                      "New connection"
                    ),
                    h("h2", {"id":"connect-title"},
                      "Connect a Telegram account"
                    )
                  ),
                  h("div", {"className":"connect-heading-actions"},
                    h("button", {"className":"guide-button","type":"button","data-guide-open":"","aria-controls":"telegram-guide-panel","aria-expanded":"false"},
                      "Help guide"
                    )
                  )
                ),
                h("p", {"id":"connect-copy","className":"muted"},
                  "Use the full phone number with country code. Telegram will deliver a verification code."
                ),
                h("form", {"id":"phone-form","className":"stack"},
                  h("div", {"className":"form-grid"},
                    h("label", {"htmlFor":"telegram-api-id"},
                      "Telegram API ID ",
                      h("input", {"id":"telegram-api-id","name":"telegramApiId","type":"text","inputMode":"numeric","autoComplete":"off","required":true})
                    ),
                    h("label", {"htmlFor":"telegram-api-hash"},
                      "Telegram API hash ",
                      h("input", {"id":"telegram-api-hash","name":"telegramApiHash","type":"password","autoComplete":"off","required":true})
                    )
                  ),
                  h("label", {"htmlFor":"phone"},
                    "Phone number"
                  ),
                  h("div", {"className":"phone-input-row"},
                    h("select", {"id":"phone-country-code","name":"countryCode","aria-label":"Country code","autoComplete":"tel-country-code","defaultValue":"+91"},
                      h("option", {"value":"+91"},
                        "IN India (+91)"
                      ),
                      h("option", {"value":"+1"},
                        "US United States (+1)"
                      ),
                      h("option", {"value":"+44"},
                        "GB United Kingdom (+44)"
                      ),
                      h("option", {"value":"+1"},
                        "CA Canada (+1)"
                      ),
                      h("option", {"value":"+61"},
                        "AU Australia (+61)"
                      ),
                      h("option", {"value":"+49"},
                        "DE Germany (+49)"
                      ),
                      h("option", {"value":"+33"},
                        "FR France (+33)"
                      ),
                      h("option", {"value":"+93"},
                        "AF Afghanistan (+93)"
                      ),
                      h("option", {"value":"+358"},
                        "AX Aland Islands (+358)"
                      ),
                      h("option", {"value":"+355"},
                        "AL Albania (+355)"
                      ),
                      h("option", {"value":"+213"},
                        "DZ Algeria (+213)"
                      ),
                      h("option", {"value":"+1"},
                        "AS American Samoa (+1)"
                      ),
                      h("option", {"value":"+376"},
                        "AD Andorra (+376)"
                      ),
                      h("option", {"value":"+244"},
                        "AO Angola (+244)"
                      ),
                      h("option", {"value":"+1"},
                        "AI Anguilla (+1)"
                      ),
                      h("option", {"value":"+1"},
                        "AG Antigua and Barbuda (+1)"
                      ),
                      h("option", {"value":"+54"},
                        "AR Argentina (+54)"
                      ),
                      h("option", {"value":"+374"},
                        "AM Armenia (+374)"
                      ),
                      h("option", {"value":"+297"},
                        "AW Aruba (+297)"
                      ),
                      h("option", {"value":"+43"},
                        "AT Austria (+43)"
                      ),
                      h("option", {"value":"+994"},
                        "AZ Azerbaijan (+994)"
                      ),
                      h("option", {"value":"+1"},
                        "BS Bahamas (+1)"
                      ),
                      h("option", {"value":"+973"},
                        "BH Bahrain (+973)"
                      ),
                      h("option", {"value":"+880"},
                        "BD Bangladesh (+880)"
                      ),
                      h("option", {"value":"+1"},
                        "BB Barbados (+1)"
                      ),
                      h("option", {"value":"+375"},
                        "BY Belarus (+375)"
                      ),
                      h("option", {"value":"+32"},
                        "BE Belgium (+32)"
                      ),
                      h("option", {"value":"+501"},
                        "BZ Belize (+501)"
                      ),
                      h("option", {"value":"+229"},
                        "BJ Benin (+229)"
                      ),
                      h("option", {"value":"+1"},
                        "BM Bermuda (+1)"
                      ),
                      h("option", {"value":"+975"},
                        "BT Bhutan (+975)"
                      ),
                      h("option", {"value":"+591"},
                        "BO Bolivia (+591)"
                      ),
                      h("option", {"value":"+599"},
                        "BQ Bonaire, Sint Eustatius and Saba (+599)"
                      ),
                      h("option", {"value":"+387"},
                        "BA Bosnia and Herzegovina (+387)"
                      ),
                      h("option", {"value":"+267"},
                        "BW Botswana (+267)"
                      ),
                      h("option", {"value":"+55"},
                        "BR Brazil (+55)"
                      ),
                      h("option", {"value":"+246"},
                        "IO British Indian Ocean Territory (+246)"
                      ),
                      h("option", {"value":"+1"},
                        "VG British Virgin Islands (+1)"
                      ),
                      h("option", {"value":"+673"},
                        "BN Brunei (+673)"
                      ),
                      h("option", {"value":"+359"},
                        "BG Bulgaria (+359)"
                      ),
                      h("option", {"value":"+226"},
                        "BF Burkina Faso (+226)"
                      ),
                      h("option", {"value":"+257"},
                        "BI Burundi (+257)"
                      ),
                      h("option", {"value":"+238"},
                        "CV Cabo Verde (+238)"
                      ),
                      h("option", {"value":"+855"},
                        "KH Cambodia (+855)"
                      ),
                      h("option", {"value":"+237"},
                        "CM Cameroon (+237)"
                      ),
                      h("option", {"value":"+1"},
                        "KY Cayman Islands (+1)"
                      ),
                      h("option", {"value":"+236"},
                        "CF Central African Republic (+236)"
                      ),
                      h("option", {"value":"+235"},
                        "TD Chad (+235)"
                      ),
                      h("option", {"value":"+56"},
                        "CL Chile (+56)"
                      ),
                      h("option", {"value":"+86"},
                        "CN China (+86)"
                      ),
                      h("option", {"value":"+61"},
                        "CX Christmas Island (+61)"
                      ),
                      h("option", {"value":"+61"},
                        "CC Cocos (Keeling) Islands (+61)"
                      ),
                      h("option", {"value":"+57"},
                        "CO Colombia (+57)"
                      ),
                      h("option", {"value":"+269"},
                        "KM Comoros (+269)"
                      ),
                      h("option", {"value":"+242"},
                        "CG Congo (+242)"
                      ),
                      h("option", {"value":"+243"},
                        "CD Congo (DRC) (+243)"
                      ),
                      h("option", {"value":"+682"},
                        "CK Cook Islands (+682)"
                      ),
                      h("option", {"value":"+506"},
                        "CR Costa Rica (+506)"
                      ),
                      h("option", {"value":"+225"},
                        "CI Cote d'Ivoire (+225)"
                      ),
                      h("option", {"value":"+385"},
                        "HR Croatia (+385)"
                      ),
                      h("option", {"value":"+53"},
                        "CU Cuba (+53)"
                      ),
                      h("option", {"value":"+599"},
                        "CW Curacao (+599)"
                      ),
                      h("option", {"value":"+357"},
                        "CY Cyprus (+357)"
                      ),
                      h("option", {"value":"+420"},
                        "CZ Czechia (+420)"
                      ),
                      h("option", {"value":"+45"},
                        "DK Denmark (+45)"
                      ),
                      h("option", {"value":"+253"},
                        "DJ Djibouti (+253)"
                      ),
                      h("option", {"value":"+1"},
                        "DM Dominica (+1)"
                      ),
                      h("option", {"value":"+1"},
                        "DO Dominican Republic (+1)"
                      ),
                      h("option", {"value":"+593"},
                        "EC Ecuador (+593)"
                      ),
                      h("option", {"value":"+20"},
                        "EG Egypt (+20)"
                      ),
                      h("option", {"value":"+503"},
                        "SV El Salvador (+503)"
                      ),
                      h("option", {"value":"+240"},
                        "GQ Equatorial Guinea (+240)"
                      ),
                      h("option", {"value":"+291"},
                        "ER Eritrea (+291)"
                      ),
                      h("option", {"value":"+372"},
                        "EE Estonia (+372)"
                      ),
                      h("option", {"value":"+268"},
                        "SZ Eswatini (+268)"
                      ),
                      h("option", {"value":"+251"},
                        "ET Ethiopia (+251)"
                      ),
                      h("option", {"value":"+500"},
                        "FK Falkland Islands (+500)"
                      ),
                      h("option", {"value":"+298"},
                        "FO Faroe Islands (+298)"
                      ),
                      h("option", {"value":"+679"},
                        "FJ Fiji (+679)"
                      ),
                      h("option", {"value":"+358"},
                        "FI Finland (+358)"
                      ),
                      h("option", {"value":"+594"},
                        "GF French Guiana (+594)"
                      ),
                      h("option", {"value":"+689"},
                        "PF French Polynesia (+689)"
                      ),
                      h("option", {"value":"+241"},
                        "GA Gabon (+241)"
                      ),
                      h("option", {"value":"+220"},
                        "GM Gambia (+220)"
                      ),
                      h("option", {"value":"+995"},
                        "GE Georgia (+995)"
                      ),
                      h("option", {"value":"+233"},
                        "GH Ghana (+233)"
                      ),
                      h("option", {"value":"+350"},
                        "GI Gibraltar (+350)"
                      ),
                      h("option", {"value":"+30"},
                        "GR Greece (+30)"
                      ),
                      h("option", {"value":"+299"},
                        "GL Greenland (+299)"
                      ),
                      h("option", {"value":"+1"},
                        "GD Grenada (+1)"
                      ),
                      h("option", {"value":"+590"},
                        "GP Guadeloupe (+590)"
                      ),
                      h("option", {"value":"+1"},
                        "GU Guam (+1)"
                      ),
                      h("option", {"value":"+502"},
                        "GT Guatemala (+502)"
                      ),
                      h("option", {"value":"+44"},
                        "GG Guernsey (+44)"
                      ),
                      h("option", {"value":"+224"},
                        "GN Guinea (+224)"
                      ),
                      h("option", {"value":"+245"},
                        "GW Guinea-Bissau (+245)"
                      ),
                      h("option", {"value":"+592"},
                        "GY Guyana (+592)"
                      ),
                      h("option", {"value":"+509"},
                        "HT Haiti (+509)"
                      ),
                      h("option", {"value":"+504"},
                        "HN Honduras (+504)"
                      ),
                      h("option", {"value":"+852"},
                        "HK Hong Kong (+852)"
                      ),
                      h("option", {"value":"+36"},
                        "HU Hungary (+36)"
                      ),
                      h("option", {"value":"+354"},
                        "IS Iceland (+354)"
                      ),
                      h("option", {"value":"+62"},
                        "ID Indonesia (+62)"
                      ),
                      h("option", {"value":"+98"},
                        "IR Iran (+98)"
                      ),
                      h("option", {"value":"+964"},
                        "IQ Iraq (+964)"
                      ),
                      h("option", {"value":"+353"},
                        "IE Ireland (+353)"
                      ),
                      h("option", {"value":"+44"},
                        "IM Isle of Man (+44)"
                      ),
                      h("option", {"value":"+972"},
                        "IL Israel (+972)"
                      ),
                      h("option", {"value":"+39"},
                        "IT Italy (+39)"
                      ),
                      h("option", {"value":"+1"},
                        "JM Jamaica (+1)"
                      ),
                      h("option", {"value":"+81"},
                        "JP Japan (+81)"
                      ),
                      h("option", {"value":"+44"},
                        "JE Jersey (+44)"
                      ),
                      h("option", {"value":"+962"},
                        "JO Jordan (+962)"
                      ),
                      h("option", {"value":"+7"},
                        "KZ Kazakhstan (+7)"
                      ),
                      h("option", {"value":"+254"},
                        "KE Kenya (+254)"
                      ),
                      h("option", {"value":"+686"},
                        "KI Kiribati (+686)"
                      ),
                      h("option", {"value":"+383"},
                        "XK Kosovo (+383)"
                      ),
                      h("option", {"value":"+965"},
                        "KW Kuwait (+965)"
                      ),
                      h("option", {"value":"+996"},
                        "KG Kyrgyzstan (+996)"
                      ),
                      h("option", {"value":"+856"},
                        "LA Laos (+856)"
                      ),
                      h("option", {"value":"+371"},
                        "LV Latvia (+371)"
                      ),
                      h("option", {"value":"+961"},
                        "LB Lebanon (+961)"
                      ),
                      h("option", {"value":"+266"},
                        "LS Lesotho (+266)"
                      ),
                      h("option", {"value":"+231"},
                        "LR Liberia (+231)"
                      ),
                      h("option", {"value":"+218"},
                        "LY Libya (+218)"
                      ),
                      h("option", {"value":"+423"},
                        "LI Liechtenstein (+423)"
                      ),
                      h("option", {"value":"+370"},
                        "LT Lithuania (+370)"
                      ),
                      h("option", {"value":"+352"},
                        "LU Luxembourg (+352)"
                      ),
                      h("option", {"value":"+853"},
                        "MO Macau (+853)"
                      ),
                      h("option", {"value":"+261"},
                        "MG Madagascar (+261)"
                      ),
                      h("option", {"value":"+265"},
                        "MW Malawi (+265)"
                      ),
                      h("option", {"value":"+60"},
                        "MY Malaysia (+60)"
                      ),
                      h("option", {"value":"+960"},
                        "MV Maldives (+960)"
                      ),
                      h("option", {"value":"+223"},
                        "ML Mali (+223)"
                      ),
                      h("option", {"value":"+356"},
                        "MT Malta (+356)"
                      ),
                      h("option", {"value":"+692"},
                        "MH Marshall Islands (+692)"
                      ),
                      h("option", {"value":"+596"},
                        "MQ Martinique (+596)"
                      ),
                      h("option", {"value":"+222"},
                        "MR Mauritania (+222)"
                      ),
                      h("option", {"value":"+230"},
                        "MU Mauritius (+230)"
                      ),
                      h("option", {"value":"+262"},
                        "YT Mayotte (+262)"
                      ),
                      h("option", {"value":"+52"},
                        "MX Mexico (+52)"
                      ),
                      h("option", {"value":"+691"},
                        "FM Micronesia (+691)"
                      ),
                      h("option", {"value":"+373"},
                        "MD Moldova (+373)"
                      ),
                      h("option", {"value":"+377"},
                        "MC Monaco (+377)"
                      ),
                      h("option", {"value":"+976"},
                        "MN Mongolia (+976)"
                      ),
                      h("option", {"value":"+382"},
                        "ME Montenegro (+382)"
                      ),
                      h("option", {"value":"+1"},
                        "MS Montserrat (+1)"
                      ),
                      h("option", {"value":"+212"},
                        "MA Morocco (+212)"
                      ),
                      h("option", {"value":"+258"},
                        "MZ Mozambique (+258)"
                      ),
                      h("option", {"value":"+95"},
                        "MM Myanmar (+95)"
                      ),
                      h("option", {"value":"+264"},
                        "NA Namibia (+264)"
                      ),
                      h("option", {"value":"+674"},
                        "NR Nauru (+674)"
                      ),
                      h("option", {"value":"+977"},
                        "NP Nepal (+977)"
                      ),
                      h("option", {"value":"+31"},
                        "NL Netherlands (+31)"
                      ),
                      h("option", {"value":"+687"},
                        "NC New Caledonia (+687)"
                      ),
                      h("option", {"value":"+64"},
                        "NZ New Zealand (+64)"
                      ),
                      h("option", {"value":"+505"},
                        "NI Nicaragua (+505)"
                      ),
                      h("option", {"value":"+227"},
                        "NE Niger (+227)"
                      ),
                      h("option", {"value":"+234"},
                        "NG Nigeria (+234)"
                      ),
                      h("option", {"value":"+683"},
                        "NU Niue (+683)"
                      ),
                      h("option", {"value":"+672"},
                        "NF Norfolk Island (+672)"
                      ),
                      h("option", {"value":"+850"},
                        "KP North Korea (+850)"
                      ),
                      h("option", {"value":"+389"},
                        "MK North Macedonia (+389)"
                      ),
                      h("option", {"value":"+1"},
                        "MP Northern Mariana Islands (+1)"
                      ),
                      h("option", {"value":"+47"},
                        "NO Norway (+47)"
                      ),
                      h("option", {"value":"+968"},
                        "OM Oman (+968)"
                      ),
                      h("option", {"value":"+92"},
                        "PK Pakistan (+92)"
                      ),
                      h("option", {"value":"+680"},
                        "PW Palau (+680)"
                      ),
                      h("option", {"value":"+970"},
                        "PS Palestine (+970)"
                      ),
                      h("option", {"value":"+507"},
                        "PA Panama (+507)"
                      ),
                      h("option", {"value":"+675"},
                        "PG Papua New Guinea (+675)"
                      ),
                      h("option", {"value":"+595"},
                        "PY Paraguay (+595)"
                      ),
                      h("option", {"value":"+51"},
                        "PE Peru (+51)"
                      ),
                      h("option", {"value":"+63"},
                        "PH Philippines (+63)"
                      ),
                      h("option", {"value":"+64"},
                        "PN Pitcairn Islands (+64)"
                      ),
                      h("option", {"value":"+48"},
                        "PL Poland (+48)"
                      ),
                      h("option", {"value":"+351"},
                        "PT Portugal (+351)"
                      ),
                      h("option", {"value":"+1"},
                        "PR Puerto Rico (+1)"
                      ),
                      h("option", {"value":"+974"},
                        "QA Qatar (+974)"
                      ),
                      h("option", {"value":"+262"},
                        "RE Reunion (+262)"
                      ),
                      h("option", {"value":"+40"},
                        "RO Romania (+40)"
                      ),
                      h("option", {"value":"+7"},
                        "RU Russia (+7)"
                      ),
                      h("option", {"value":"+250"},
                        "RW Rwanda (+250)"
                      ),
                      h("option", {"value":"+590"},
                        "BL Saint Barthelemy (+590)"
                      ),
                      h("option", {"value":"+290"},
                        "SH Saint Helena (+290)"
                      ),
                      h("option", {"value":"+1"},
                        "KN Saint Kitts and Nevis (+1)"
                      ),
                      h("option", {"value":"+1"},
                        "LC Saint Lucia (+1)"
                      ),
                      h("option", {"value":"+590"},
                        "MF Saint Martin (+590)"
                      ),
                      h("option", {"value":"+508"},
                        "PM Saint Pierre and Miquelon (+508)"
                      ),
                      h("option", {"value":"+1"},
                        "VC Saint Vincent and the Grenadines (+1)"
                      ),
                      h("option", {"value":"+685"},
                        "WS Samoa (+685)"
                      ),
                      h("option", {"value":"+378"},
                        "SM San Marino (+378)"
                      ),
                      h("option", {"value":"+239"},
                        "ST Sao Tome and Principe (+239)"
                      ),
                      h("option", {"value":"+966"},
                        "SA Saudi Arabia (+966)"
                      ),
                      h("option", {"value":"+221"},
                        "SN Senegal (+221)"
                      ),
                      h("option", {"value":"+381"},
                        "RS Serbia (+381)"
                      ),
                      h("option", {"value":"+248"},
                        "SC Seychelles (+248)"
                      ),
                      h("option", {"value":"+232"},
                        "SL Sierra Leone (+232)"
                      ),
                      h("option", {"value":"+65"},
                        "SG Singapore (+65)"
                      ),
                      h("option", {"value":"+1"},
                        "SX Sint Maarten (+1)"
                      ),
                      h("option", {"value":"+421"},
                        "SK Slovakia (+421)"
                      ),
                      h("option", {"value":"+386"},
                        "SI Slovenia (+386)"
                      ),
                      h("option", {"value":"+677"},
                        "SB Solomon Islands (+677)"
                      ),
                      h("option", {"value":"+252"},
                        "SO Somalia (+252)"
                      ),
                      h("option", {"value":"+27"},
                        "ZA South Africa (+27)"
                      ),
                      h("option", {"value":"+82"},
                        "KR South Korea (+82)"
                      ),
                      h("option", {"value":"+211"},
                        "SS South Sudan (+211)"
                      ),
                      h("option", {"value":"+34"},
                        "ES Spain (+34)"
                      ),
                      h("option", {"value":"+94"},
                        "LK Sri Lanka (+94)"
                      ),
                      h("option", {"value":"+249"},
                        "SD Sudan (+249)"
                      ),
                      h("option", {"value":"+597"},
                        "SR Suriname (+597)"
                      ),
                      h("option", {"value":"+47"},
                        "SJ Svalbard and Jan Mayen (+47)"
                      ),
                      h("option", {"value":"+46"},
                        "SE Sweden (+46)"
                      ),
                      h("option", {"value":"+41"},
                        "CH Switzerland (+41)"
                      ),
                      h("option", {"value":"+963"},
                        "SY Syria (+963)"
                      ),
                      h("option", {"value":"+886"},
                        "TW Taiwan (+886)"
                      ),
                      h("option", {"value":"+992"},
                        "TJ Tajikistan (+992)"
                      ),
                      h("option", {"value":"+255"},
                        "TZ Tanzania (+255)"
                      ),
                      h("option", {"value":"+66"},
                        "TH Thailand (+66)"
                      ),
                      h("option", {"value":"+670"},
                        "TL Timor-Leste (+670)"
                      ),
                      h("option", {"value":"+228"},
                        "TG Togo (+228)"
                      ),
                      h("option", {"value":"+690"},
                        "TK Tokelau (+690)"
                      ),
                      h("option", {"value":"+676"},
                        "TO Tonga (+676)"
                      ),
                      h("option", {"value":"+1"},
                        "TT Trinidad and Tobago (+1)"
                      ),
                      h("option", {"value":"+216"},
                        "TN Tunisia (+216)"
                      ),
                      h("option", {"value":"+90"},
                        "TR Turkey (+90)"
                      ),
                      h("option", {"value":"+993"},
                        "TM Turkmenistan (+993)"
                      ),
                      h("option", {"value":"+1"},
                        "TC Turks and Caicos Islands (+1)"
                      ),
                      h("option", {"value":"+688"},
                        "TV Tuvalu (+688)"
                      ),
                      h("option", {"value":"+256"},
                        "UG Uganda (+256)"
                      ),
                      h("option", {"value":"+380"},
                        "UA Ukraine (+380)"
                      ),
                      h("option", {"value":"+971"},
                        "AE United Arab Emirates (+971)"
                      ),
                      h("option", {"value":"+1"},
                        "VI United States Virgin Islands (+1)"
                      ),
                      h("option", {"value":"+598"},
                        "UY Uruguay (+598)"
                      ),
                      h("option", {"value":"+998"},
                        "UZ Uzbekistan (+998)"
                      ),
                      h("option", {"value":"+678"},
                        "VU Vanuatu (+678)"
                      ),
                      h("option", {"value":"+39"},
                        "VA Vatican City (+39)"
                      ),
                      h("option", {"value":"+58"},
                        "VE Venezuela (+58)"
                      ),
                      h("option", {"value":"+84"},
                        "VN Vietnam (+84)"
                      ),
                      h("option", {"value":"+681"},
                        "WF Wallis and Futuna (+681)"
                      ),
                      h("option", {"value":"+212"},
                        "EH Western Sahara (+212)"
                      ),
                      h("option", {"value":"+967"},
                        "YE Yemen (+967)"
                      ),
                      h("option", {"value":"+260"},
                        "ZM Zambia (+260)"
                      ),
                      h("option", {"value":"+263"},
                        "ZW Zimbabwe (+263)"
                      )
                    ),
                    h("input", {"id":"phone","name":"phone","type":"tel","autoComplete":"tel-national","inputMode":"tel","placeholder":"9876543210","required":true})
                  ),
                  h("button", {"className":"button primary","type":"submit"},
                    "Send verification code"
                  )
                ),
                h("form", {"id":"code-form","className":"stack","hidden":true},
                  h("label", {"htmlFor":"code"},
                    "Verification code"
                  ),
                  h("input", {"id":"code","name":"code","type":"text","autoComplete":"one-time-code","inputMode":"numeric","maxLength":"16","required":true}),
                  h("button", {"className":"button primary","type":"submit"},
                    "Verify code"
                  ),
                  h("button", {"className":"button text","type":"button","data-reset-login":""},
                    "Start over"
                  )
                ),
                h("form", {"id":"password-form","className":"stack","hidden":true},
                  h("label", {"htmlFor":"telegram-password"},
                    "Two-factor password"
                  ),
                  h("input", {"id":"telegram-password","name":"password","type":"password","autoComplete":"current-password","required":true}),
                  h("button", {"className":"button primary","type":"submit"},
                    "Connect account"
                  ),
                  h("button", {"className":"button text","type":"button","data-reset-login":""},
                    "Start over"
                  )
                ),
                h("p", {"id":"connect-status","className":"status","role":"status","aria-live":"polite"})
              )
            ),
            h("section", {"id":"view-manage-numbers","className":"view","hidden":true},
              h("section", {"className":"panel","aria-labelledby":"manage-numbers-title"},
                h("div", {"className":"panel-heading"},
                  h("div", null,
                    h("p", {"className":"eyebrow"},
                      "Accounts"
                    ),
                    h("h2", {"id":"manage-numbers-title"},
                      "Connected accounts"
                    )
                  ),
                  h("button", {"className":"button ghost","type":"button","data-jump":"add-number"},
                    "Add number"
                  )
                ),
                h("div", {"className":"toolbar"},
                  h("input", {"id":"number-search","type":"search","placeholder":"Search numbers, names, usernames"}),
                  h("select", {"id":"number-status-filter"},
                    h("option", {"value":""},
                      "All statuses"
                    ),
                    h("option", {"value":"Active"},
                      "Active"
                    ),
                    h("option", {"value":"Paused"},
                      "Paused"
                    ),
                    h("option", {"value":"Archived"},
                      "Archived"
                    )
                  )
                ),
                h("div", {"id":"account-list","className":"account-list","aria-live":"polite"})
              )
            ),
            h("section", {"id":"view-profiles","className":"view","hidden":true},
              h("div", {"className":"two-column"},
                h("section", {"className":"panel","aria-labelledby":"profile-editor-title"},
                  h("div", {"className":"panel-heading"},
                    h("div", null,
                      h("p", {"className":"eyebrow"},
                        "Account identity"
                      ),
                      h("h2", {"id":"profile-editor-title"},
                        "Profile details"
                      )
                    )
                  ),
                  h("form", {"id":"profile-form","className":"stack","noValidate":true},
                    h("label", {"htmlFor":"profile-name"},
                      "Profile name"
                    ),
                    h("input", {"id":"profile-name","name":"profileName","type":"text","required":true}),
                    h("label", {"htmlFor":"profile-display-name"},
                      "Display name"
                    ),
                    h("input", {"id":"profile-display-name","name":"displayName","type":"text"}),
                    h("label", {"htmlFor":"profile-username"},
                      "Username"
                    ),
                    h("input", {"id":"profile-username","name":"username","type":"text"}),
                    h("label", {"htmlFor":"profile-phone"},
                      "Phone number"
                    ),
                    h("input", {"id":"profile-phone","name":"phone","type":"tel","inputMode":"tel"}),
                    h("label", {"htmlFor":"profile-status"},
                      "Status"
                    ),
                    h("select", {"id":"profile-status","name":"status"},
                      h("option", null,
                        "Active"
                      ),
                      h("option", null,
                        "Paused"
                      ),
                      h("option", null,
                        "Archived"
                      )
                    ),
                    h("label", {"htmlFor":"profile-avatar"},
                      "Avatar/Image URL"
                    ),
                    h("input", {"id":"profile-avatar","name":"avatar","type":"url","placeholder":"https://example.com/avatar.png"}),
                    h("label", {"htmlFor":"profile-config-numbers"},
                      "Config number(s)"
                    ),
                    h("textarea", {"id":"profile-config-numbers","name":"configNumbers","rows":"3","placeholder":"One number per line"}),
                    h("label", {"htmlFor":"profile-description"},
                      "Description"
                    ),
                    h("textarea", {"id":"profile-description","name":"description","rows":"4"}),
                    h("button", {"className":"button primary","type":"submit"},
                      "Save profile"
                    )
                  ),
                  h("p", {"id":"profile-status-message","className":"status","role":"status","aria-live":"polite"})
                ),
                h("section", {"className":"panel","aria-labelledby":"profile-list-title"},
                  h("div", {"className":"panel-heading"},
                    h("div", null,
                      h("p", {"className":"eyebrow"},
                        "Select a profile"
                      ),
                      h("h2", {"id":"profile-list-title"},
                        "Available profiles"
                      )
                    )
                  ),
                  h("div", {"id":"profile-list","className":"profile-list"})
                )
              )
            ),
            h("section", {"id":"view-applications","className":"view","hidden":true},
              h("section", {"className":"panel","aria-labelledby":"applications-title"},
                h("div", {"className":"panel-heading"},
                  h("div", null,
                    h("p", {"className":"eyebrow"},
                      "Multi-application support"
                    ),
                    h("h2", {"id":"applications-title"},
                      "Workflow applications"
                    )
                  )
                ),
                h("div", {"id":"application-list","className":"application-grid"})
              )
            ),
            h("section", {"id":"view-contacts","className":"view","hidden":true},
              h("section", {"className":"panel","aria-labelledby":"contacts-title"},
                h("div", {"className":"panel-heading"},
                  h("div", null,
                    h("p", {"className":"eyebrow"},
                      "Audience"
                    ),
                    h("h2", {"id":"contacts-title"},
                      "Contacts"
                    ),
                    h("p", {"className":"panel-description"},
                      "Save the people you message often and keep every conversation within reach."
                    )
                  )
                ),
                h("div", {"className":"module-grid contact-module-grid"},
                  h("form", {"id":"contact-form","className":"stack contact-editor","noValidate":true},
                    h("div", {"className":"contact-section-heading"},
                      h("p", {"className":"eyebrow"},
                        "New contact"
                      ),
                      h("h3", null,
                        "Add someone"
                      ),
                      h("p", null,
                        "Enter a name and at least one way to reach them on Telegram."
                      )
                    ),
                    h("input", {"id":"contact-id","type":"hidden"}),
                    h("label", {"htmlFor":"contact-name"},
                      "Name"
                    ),
                    h("input", {"id":"contact-name","type":"text","required":true}),
                    h("label", {"htmlFor":"contact-handle"},
                      "Username"
                    ),
                    h("input", {"id":"contact-handle","type":"text","placeholder":"@username"}),
                    h("label", {"htmlFor":"contact-phone"},
                      "Phone"
                    ),
                    h("div", {"className":"phone-input-row"},
                      h("select", {"id":"contact-country-code","name":"countryCode","aria-label":"Country code","autoComplete":"tel-country-code","defaultValue":"+91"},
                        h("option", {"value":"+91"},
                          "IN India (+91)"
                        ),
                        h("option", {"value":"+1"},
                          "US United States (+1)"
                        ),
                        h("option", {"value":"+44"},
                          "GB United Kingdom (+44)"
                        ),
                        h("option", {"value":"+1"},
                          "CA Canada (+1)"
                        ),
                        h("option", {"value":"+61"},
                          "AU Australia (+61)"
                        ),
                        h("option", {"value":"+49"},
                          "DE Germany (+49)"
                        ),
                        h("option", {"value":"+33"},
                          "FR France (+33)"
                        ),
                        h("option", {"value":"+93"},
                          "AF Afghanistan (+93)"
                        ),
                        h("option", {"value":"+358"},
                          "AX Aland Islands (+358)"
                        ),
                        h("option", {"value":"+355"},
                          "AL Albania (+355)"
                        ),
                        h("option", {"value":"+213"},
                          "DZ Algeria (+213)"
                        ),
                        h("option", {"value":"+1"},
                          "AS American Samoa (+1)"
                        ),
                        h("option", {"value":"+376"},
                          "AD Andorra (+376)"
                        ),
                        h("option", {"value":"+244"},
                          "AO Angola (+244)"
                        ),
                        h("option", {"value":"+1"},
                          "AI Anguilla (+1)"
                        ),
                        h("option", {"value":"+1"},
                          "AG Antigua and Barbuda (+1)"
                        ),
                        h("option", {"value":"+54"},
                          "AR Argentina (+54)"
                        ),
                        h("option", {"value":"+374"},
                          "AM Armenia (+374)"
                        ),
                        h("option", {"value":"+297"},
                          "AW Aruba (+297)"
                        ),
                        h("option", {"value":"+43"},
                          "AT Austria (+43)"
                        ),
                        h("option", {"value":"+994"},
                          "AZ Azerbaijan (+994)"
                        ),
                        h("option", {"value":"+1"},
                          "BS Bahamas (+1)"
                        ),
                        h("option", {"value":"+973"},
                          "BH Bahrain (+973)"
                        ),
                        h("option", {"value":"+880"},
                          "BD Bangladesh (+880)"
                        ),
                        h("option", {"value":"+1"},
                          "BB Barbados (+1)"
                        ),
                        h("option", {"value":"+375"},
                          "BY Belarus (+375)"
                        ),
                        h("option", {"value":"+32"},
                          "BE Belgium (+32)"
                        ),
                        h("option", {"value":"+501"},
                          "BZ Belize (+501)"
                        ),
                        h("option", {"value":"+229"},
                          "BJ Benin (+229)"
                        ),
                        h("option", {"value":"+1"},
                          "BM Bermuda (+1)"
                        ),
                        h("option", {"value":"+975"},
                          "BT Bhutan (+975)"
                        ),
                        h("option", {"value":"+591"},
                          "BO Bolivia (+591)"
                        ),
                        h("option", {"value":"+599"},
                          "BQ Bonaire, Sint Eustatius and Saba (+599)"
                        ),
                        h("option", {"value":"+387"},
                          "BA Bosnia and Herzegovina (+387)"
                        ),
                        h("option", {"value":"+267"},
                          "BW Botswana (+267)"
                        ),
                        h("option", {"value":"+55"},
                          "BR Brazil (+55)"
                        ),
                        h("option", {"value":"+246"},
                          "IO British Indian Ocean Territory (+246)"
                        ),
                        h("option", {"value":"+1"},
                          "VG British Virgin Islands (+1)"
                        ),
                        h("option", {"value":"+673"},
                          "BN Brunei (+673)"
                        ),
                        h("option", {"value":"+359"},
                          "BG Bulgaria (+359)"
                        ),
                        h("option", {"value":"+226"},
                          "BF Burkina Faso (+226)"
                        ),
                        h("option", {"value":"+257"},
                          "BI Burundi (+257)"
                        ),
                        h("option", {"value":"+238"},
                          "CV Cabo Verde (+238)"
                        ),
                        h("option", {"value":"+855"},
                          "KH Cambodia (+855)"
                        ),
                        h("option", {"value":"+237"},
                          "CM Cameroon (+237)"
                        ),
                        h("option", {"value":"+1"},
                          "KY Cayman Islands (+1)"
                        ),
                        h("option", {"value":"+236"},
                          "CF Central African Republic (+236)"
                        ),
                        h("option", {"value":"+235"},
                          "TD Chad (+235)"
                        ),
                        h("option", {"value":"+56"},
                          "CL Chile (+56)"
                        ),
                        h("option", {"value":"+86"},
                          "CN China (+86)"
                        ),
                        h("option", {"value":"+61"},
                          "CX Christmas Island (+61)"
                        ),
                        h("option", {"value":"+61"},
                          "CC Cocos (Keeling) Islands (+61)"
                        ),
                        h("option", {"value":"+57"},
                          "CO Colombia (+57)"
                        ),
                        h("option", {"value":"+269"},
                          "KM Comoros (+269)"
                        ),
                        h("option", {"value":"+242"},
                          "CG Congo (+242)"
                        ),
                        h("option", {"value":"+243"},
                          "CD Congo (DRC) (+243)"
                        ),
                        h("option", {"value":"+682"},
                          "CK Cook Islands (+682)"
                        ),
                        h("option", {"value":"+506"},
                          "CR Costa Rica (+506)"
                        ),
                        h("option", {"value":"+225"},
                          "CI Cote d'Ivoire (+225)"
                        ),
                        h("option", {"value":"+385"},
                          "HR Croatia (+385)"
                        ),
                        h("option", {"value":"+53"},
                          "CU Cuba (+53)"
                        ),
                        h("option", {"value":"+599"},
                          "CW Curacao (+599)"
                        ),
                        h("option", {"value":"+357"},
                          "CY Cyprus (+357)"
                        ),
                        h("option", {"value":"+420"},
                          "CZ Czechia (+420)"
                        ),
                        h("option", {"value":"+45"},
                          "DK Denmark (+45)"
                        ),
                        h("option", {"value":"+253"},
                          "DJ Djibouti (+253)"
                        ),
                        h("option", {"value":"+1"},
                          "DM Dominica (+1)"
                        ),
                        h("option", {"value":"+1"},
                          "DO Dominican Republic (+1)"
                        ),
                        h("option", {"value":"+593"},
                          "EC Ecuador (+593)"
                        ),
                        h("option", {"value":"+20"},
                          "EG Egypt (+20)"
                        ),
                        h("option", {"value":"+503"},
                          "SV El Salvador (+503)"
                        ),
                        h("option", {"value":"+240"},
                          "GQ Equatorial Guinea (+240)"
                        ),
                        h("option", {"value":"+291"},
                          "ER Eritrea (+291)"
                        ),
                        h("option", {"value":"+372"},
                          "EE Estonia (+372)"
                        ),
                        h("option", {"value":"+268"},
                          "SZ Eswatini (+268)"
                        ),
                        h("option", {"value":"+251"},
                          "ET Ethiopia (+251)"
                        ),
                        h("option", {"value":"+500"},
                          "FK Falkland Islands (+500)"
                        ),
                        h("option", {"value":"+298"},
                          "FO Faroe Islands (+298)"
                        ),
                        h("option", {"value":"+679"},
                          "FJ Fiji (+679)"
                        ),
                        h("option", {"value":"+358"},
                          "FI Finland (+358)"
                        ),
                        h("option", {"value":"+594"},
                          "GF French Guiana (+594)"
                        ),
                        h("option", {"value":"+689"},
                          "PF French Polynesia (+689)"
                        ),
                        h("option", {"value":"+241"},
                          "GA Gabon (+241)"
                        ),
                        h("option", {"value":"+220"},
                          "GM Gambia (+220)"
                        ),
                        h("option", {"value":"+995"},
                          "GE Georgia (+995)"
                        ),
                        h("option", {"value":"+233"},
                          "GH Ghana (+233)"
                        ),
                        h("option", {"value":"+350"},
                          "GI Gibraltar (+350)"
                        ),
                        h("option", {"value":"+30"},
                          "GR Greece (+30)"
                        ),
                        h("option", {"value":"+299"},
                          "GL Greenland (+299)"
                        ),
                        h("option", {"value":"+1"},
                          "GD Grenada (+1)"
                        ),
                        h("option", {"value":"+590"},
                          "GP Guadeloupe (+590)"
                        ),
                        h("option", {"value":"+1"},
                          "GU Guam (+1)"
                        ),
                        h("option", {"value":"+502"},
                          "GT Guatemala (+502)"
                        ),
                        h("option", {"value":"+44"},
                          "GG Guernsey (+44)"
                        ),
                        h("option", {"value":"+224"},
                          "GN Guinea (+224)"
                        ),
                        h("option", {"value":"+245"},
                          "GW Guinea-Bissau (+245)"
                        ),
                        h("option", {"value":"+592"},
                          "GY Guyana (+592)"
                        ),
                        h("option", {"value":"+509"},
                          "HT Haiti (+509)"
                        ),
                        h("option", {"value":"+504"},
                          "HN Honduras (+504)"
                        ),
                        h("option", {"value":"+852"},
                          "HK Hong Kong (+852)"
                        ),
                        h("option", {"value":"+36"},
                          "HU Hungary (+36)"
                        ),
                        h("option", {"value":"+354"},
                          "IS Iceland (+354)"
                        ),
                        h("option", {"value":"+62"},
                          "ID Indonesia (+62)"
                        ),
                        h("option", {"value":"+98"},
                          "IR Iran (+98)"
                        ),
                        h("option", {"value":"+964"},
                          "IQ Iraq (+964)"
                        ),
                        h("option", {"value":"+353"},
                          "IE Ireland (+353)"
                        ),
                        h("option", {"value":"+44"},
                          "IM Isle of Man (+44)"
                        ),
                        h("option", {"value":"+972"},
                          "IL Israel (+972)"
                        ),
                        h("option", {"value":"+39"},
                          "IT Italy (+39)"
                        ),
                        h("option", {"value":"+1"},
                          "JM Jamaica (+1)"
                        ),
                        h("option", {"value":"+81"},
                          "JP Japan (+81)"
                        ),
                        h("option", {"value":"+44"},
                          "JE Jersey (+44)"
                        ),
                        h("option", {"value":"+962"},
                          "JO Jordan (+962)"
                        ),
                        h("option", {"value":"+7"},
                          "KZ Kazakhstan (+7)"
                        ),
                        h("option", {"value":"+254"},
                          "KE Kenya (+254)"
                        ),
                        h("option", {"value":"+686"},
                          "KI Kiribati (+686)"
                        ),
                        h("option", {"value":"+383"},
                          "XK Kosovo (+383)"
                        ),
                        h("option", {"value":"+965"},
                          "KW Kuwait (+965)"
                        ),
                        h("option", {"value":"+996"},
                          "KG Kyrgyzstan (+996)"
                        ),
                        h("option", {"value":"+856"},
                          "LA Laos (+856)"
                        ),
                        h("option", {"value":"+371"},
                          "LV Latvia (+371)"
                        ),
                        h("option", {"value":"+961"},
                          "LB Lebanon (+961)"
                        ),
                        h("option", {"value":"+266"},
                          "LS Lesotho (+266)"
                        ),
                        h("option", {"value":"+231"},
                          "LR Liberia (+231)"
                        ),
                        h("option", {"value":"+218"},
                          "LY Libya (+218)"
                        ),
                        h("option", {"value":"+423"},
                          "LI Liechtenstein (+423)"
                        ),
                        h("option", {"value":"+370"},
                          "LT Lithuania (+370)"
                        ),
                        h("option", {"value":"+352"},
                          "LU Luxembourg (+352)"
                        ),
                        h("option", {"value":"+853"},
                          "MO Macau (+853)"
                        ),
                        h("option", {"value":"+261"},
                          "MG Madagascar (+261)"
                        ),
                        h("option", {"value":"+265"},
                          "MW Malawi (+265)"
                        ),
                        h("option", {"value":"+60"},
                          "MY Malaysia (+60)"
                        ),
                        h("option", {"value":"+960"},
                          "MV Maldives (+960)"
                        ),
                        h("option", {"value":"+223"},
                          "ML Mali (+223)"
                        ),
                        h("option", {"value":"+356"},
                          "MT Malta (+356)"
                        ),
                        h("option", {"value":"+692"},
                          "MH Marshall Islands (+692)"
                        ),
                        h("option", {"value":"+596"},
                          "MQ Martinique (+596)"
                        ),
                        h("option", {"value":"+222"},
                          "MR Mauritania (+222)"
                        ),
                        h("option", {"value":"+230"},
                          "MU Mauritius (+230)"
                        ),
                        h("option", {"value":"+262"},
                          "YT Mayotte (+262)"
                        ),
                        h("option", {"value":"+52"},
                          "MX Mexico (+52)"
                        ),
                        h("option", {"value":"+691"},
                          "FM Micronesia (+691)"
                        ),
                        h("option", {"value":"+373"},
                          "MD Moldova (+373)"
                        ),
                        h("option", {"value":"+377"},
                          "MC Monaco (+377)"
                        ),
                        h("option", {"value":"+976"},
                          "MN Mongolia (+976)"
                        ),
                        h("option", {"value":"+382"},
                          "ME Montenegro (+382)"
                        ),
                        h("option", {"value":"+1"},
                          "MS Montserrat (+1)"
                        ),
                        h("option", {"value":"+212"},
                          "MA Morocco (+212)"
                        ),
                        h("option", {"value":"+258"},
                          "MZ Mozambique (+258)"
                        ),
                        h("option", {"value":"+95"},
                          "MM Myanmar (+95)"
                        ),
                        h("option", {"value":"+264"},
                          "NA Namibia (+264)"
                        ),
                        h("option", {"value":"+674"},
                          "NR Nauru (+674)"
                        ),
                        h("option", {"value":"+977"},
                          "NP Nepal (+977)"
                        ),
                        h("option", {"value":"+31"},
                          "NL Netherlands (+31)"
                        ),
                        h("option", {"value":"+687"},
                          "NC New Caledonia (+687)"
                        ),
                        h("option", {"value":"+64"},
                          "NZ New Zealand (+64)"
                        ),
                        h("option", {"value":"+505"},
                          "NI Nicaragua (+505)"
                        ),
                        h("option", {"value":"+227"},
                          "NE Niger (+227)"
                        ),
                        h("option", {"value":"+234"},
                          "NG Nigeria (+234)"
                        ),
                        h("option", {"value":"+683"},
                          "NU Niue (+683)"
                        ),
                        h("option", {"value":"+672"},
                          "NF Norfolk Island (+672)"
                        ),
                        h("option", {"value":"+850"},
                          "KP North Korea (+850)"
                        ),
                        h("option", {"value":"+389"},
                          "MK North Macedonia (+389)"
                        ),
                        h("option", {"value":"+1"},
                          "MP Northern Mariana Islands (+1)"
                        ),
                        h("option", {"value":"+47"},
                          "NO Norway (+47)"
                        ),
                        h("option", {"value":"+968"},
                          "OM Oman (+968)"
                        ),
                        h("option", {"value":"+92"},
                          "PK Pakistan (+92)"
                        ),
                        h("option", {"value":"+680"},
                          "PW Palau (+680)"
                        ),
                        h("option", {"value":"+970"},
                          "PS Palestine (+970)"
                        ),
                        h("option", {"value":"+507"},
                          "PA Panama (+507)"
                        ),
                        h("option", {"value":"+675"},
                          "PG Papua New Guinea (+675)"
                        ),
                        h("option", {"value":"+595"},
                          "PY Paraguay (+595)"
                        ),
                        h("option", {"value":"+51"},
                          "PE Peru (+51)"
                        ),
                        h("option", {"value":"+63"},
                          "PH Philippines (+63)"
                        ),
                        h("option", {"value":"+64"},
                          "PN Pitcairn Islands (+64)"
                        ),
                        h("option", {"value":"+48"},
                          "PL Poland (+48)"
                        ),
                        h("option", {"value":"+351"},
                          "PT Portugal (+351)"
                        ),
                        h("option", {"value":"+1"},
                          "PR Puerto Rico (+1)"
                        ),
                        h("option", {"value":"+974"},
                          "QA Qatar (+974)"
                        ),
                        h("option", {"value":"+262"},
                          "RE Reunion (+262)"
                        ),
                        h("option", {"value":"+40"},
                          "RO Romania (+40)"
                        ),
                        h("option", {"value":"+7"},
                          "RU Russia (+7)"
                        ),
                        h("option", {"value":"+250"},
                          "RW Rwanda (+250)"
                        ),
                        h("option", {"value":"+590"},
                          "BL Saint Barthelemy (+590)"
                        ),
                        h("option", {"value":"+290"},
                          "SH Saint Helena (+290)"
                        ),
                        h("option", {"value":"+1"},
                          "KN Saint Kitts and Nevis (+1)"
                        ),
                        h("option", {"value":"+1"},
                          "LC Saint Lucia (+1)"
                        ),
                        h("option", {"value":"+590"},
                          "MF Saint Martin (+590)"
                        ),
                        h("option", {"value":"+508"},
                          "PM Saint Pierre and Miquelon (+508)"
                        ),
                        h("option", {"value":"+1"},
                          "VC Saint Vincent and the Grenadines (+1)"
                        ),
                        h("option", {"value":"+685"},
                          "WS Samoa (+685)"
                        ),
                        h("option", {"value":"+378"},
                          "SM San Marino (+378)"
                        ),
                        h("option", {"value":"+239"},
                          "ST Sao Tome and Principe (+239)"
                        ),
                        h("option", {"value":"+966"},
                          "SA Saudi Arabia (+966)"
                        ),
                        h("option", {"value":"+221"},
                          "SN Senegal (+221)"
                        ),
                        h("option", {"value":"+381"},
                          "RS Serbia (+381)"
                        ),
                        h("option", {"value":"+248"},
                          "SC Seychelles (+248)"
                        ),
                        h("option", {"value":"+232"},
                          "SL Sierra Leone (+232)"
                        ),
                        h("option", {"value":"+65"},
                          "SG Singapore (+65)"
                        ),
                        h("option", {"value":"+1"},
                          "SX Sint Maarten (+1)"
                        ),
                        h("option", {"value":"+421"},
                          "SK Slovakia (+421)"
                        ),
                        h("option", {"value":"+386"},
                          "SI Slovenia (+386)"
                        ),
                        h("option", {"value":"+677"},
                          "SB Solomon Islands (+677)"
                        ),
                        h("option", {"value":"+252"},
                          "SO Somalia (+252)"
                        ),
                        h("option", {"value":"+27"},
                          "ZA South Africa (+27)"
                        ),
                        h("option", {"value":"+82"},
                          "KR South Korea (+82)"
                        ),
                        h("option", {"value":"+211"},
                          "SS South Sudan (+211)"
                        ),
                        h("option", {"value":"+34"},
                          "ES Spain (+34)"
                        ),
                        h("option", {"value":"+94"},
                          "LK Sri Lanka (+94)"
                        ),
                        h("option", {"value":"+249"},
                          "SD Sudan (+249)"
                        ),
                        h("option", {"value":"+597"},
                          "SR Suriname (+597)"
                        ),
                        h("option", {"value":"+47"},
                          "SJ Svalbard and Jan Mayen (+47)"
                        ),
                        h("option", {"value":"+46"},
                          "SE Sweden (+46)"
                        ),
                        h("option", {"value":"+41"},
                          "CH Switzerland (+41)"
                        ),
                        h("option", {"value":"+963"},
                          "SY Syria (+963)"
                        ),
                        h("option", {"value":"+886"},
                          "TW Taiwan (+886)"
                        ),
                        h("option", {"value":"+992"},
                          "TJ Tajikistan (+992)"
                        ),
                        h("option", {"value":"+255"},
                          "TZ Tanzania (+255)"
                        ),
                        h("option", {"value":"+66"},
                          "TH Thailand (+66)"
                        ),
                        h("option", {"value":"+670"},
                          "TL Timor-Leste (+670)"
                        ),
                        h("option", {"value":"+228"},
                          "TG Togo (+228)"
                        ),
                        h("option", {"value":"+690"},
                          "TK Tokelau (+690)"
                        ),
                        h("option", {"value":"+676"},
                          "TO Tonga (+676)"
                        ),
                        h("option", {"value":"+1"},
                          "TT Trinidad and Tobago (+1)"
                        ),
                        h("option", {"value":"+216"},
                          "TN Tunisia (+216)"
                        ),
                        h("option", {"value":"+90"},
                          "TR Turkey (+90)"
                        ),
                        h("option", {"value":"+993"},
                          "TM Turkmenistan (+993)"
                        ),
                        h("option", {"value":"+1"},
                          "TC Turks and Caicos Islands (+1)"
                        ),
                        h("option", {"value":"+688"},
                          "TV Tuvalu (+688)"
                        ),
                        h("option", {"value":"+256"},
                          "UG Uganda (+256)"
                        ),
                        h("option", {"value":"+380"},
                          "UA Ukraine (+380)"
                        ),
                        h("option", {"value":"+971"},
                          "AE United Arab Emirates (+971)"
                        ),
                        h("option", {"value":"+1"},
                          "VI United States Virgin Islands (+1)"
                        ),
                        h("option", {"value":"+598"},
                          "UY Uruguay (+598)"
                        ),
                        h("option", {"value":"+998"},
                          "UZ Uzbekistan (+998)"
                        ),
                        h("option", {"value":"+678"},
                          "VU Vanuatu (+678)"
                        ),
                        h("option", {"value":"+39"},
                          "VA Vatican City (+39)"
                        ),
                        h("option", {"value":"+58"},
                          "VE Venezuela (+58)"
                        ),
                        h("option", {"value":"+84"},
                          "VN Vietnam (+84)"
                        ),
                        h("option", {"value":"+681"},
                          "WF Wallis and Futuna (+681)"
                        ),
                        h("option", {"value":"+212"},
                          "EH Western Sahara (+212)"
                        ),
                        h("option", {"value":"+967"},
                          "YE Yemen (+967)"
                        ),
                        h("option", {"value":"+260"},
                          "ZM Zambia (+260)"
                        ),
                        h("option", {"value":"+263"},
                          "ZW Zimbabwe (+263)"
                        )
                      ),
                      h("input", {"id":"contact-phone","name":"phone","type":"tel","inputMode":"tel","autoComplete":"tel-national","placeholder":"9876543210"})
                    ),
                    h("label", {"htmlFor":"contact-group"},
                      "Contact group"
                    ),
                    h("input", {"id":"contact-group","type":"text","placeholder":"Marketing"}),
                    h("label", {"htmlFor":"contact-notes"},
                      "Notes"
                    ),
                    h("textarea", {"id":"contact-notes","rows":"3"}),
                    h("div", {"className":"button-row"},
                      h("button", {"className":"button primary","type":"submit"},
                        "Save contact"
                      ),
                      h("button", {"id":"contact-clear","className":"button ghost","type":"button"},
                        "Clear"
                      )
                    )
                  ),
                  h("section", {"className":"contact-directory","aria-labelledby":"contact-directory-title"},
                    h("div", {"className":"contact-directory-heading"},
                      h("div", null,
                        h("p", {"className":"eyebrow"},
                          "Directory"
                        ),
                        h("h3", {"id":"contact-directory-title"},
                          "Saved people"
                        )
                      ),
                      h("span", {"id":"contact-count","className":"contact-count"},
                        "0 contacts"
                      )
                    ),
                    h("p", {"className":"contact-directory-copy"},
                      "Contacts you add will be ready for direct messages and targeted campaigns."
                    ),
                    h("div", {"id":"contact-list","className":"record-list contact-record-list"})
                  )
                ),
                h("p", {"id":"contact-status","className":"status","role":"status","aria-live":"polite"})
              )
            ),
            h("section", {"id":"view-inbox","className":"view","hidden":true},
              h("section", {"className":"panel","aria-labelledby":"inbox-title"},
                h("div", {"className":"panel-heading"},
                  h("div", null,
                    h("p", {"className":"eyebrow"},
                      "Conversations"
                    ),
                    h("h2", {"id":"inbox-title"},
                      "Inbox"
                    )
                  ),
                  h("div", {"className":"inbox-actions"},
                    h("div", {"className":"segmented-control inbox-view-control","role":"group","aria-label":"Message view styles"},
                      h("span", {"className":"segmented-label"},
                        "Views"
                      ),
                      h("button", {"className":"view-choice active","type":"button","data-inbox-view":"split","aria-pressed":"true","title":"Split view"},
                        "Split"
                      ),
                      h("button", {"className":"view-choice","type":"button","data-inbox-view":"compact","aria-pressed":"false","title":"Compact view"},
                        "Compact"
                      ),
                      h("button", {"className":"view-choice","type":"button","data-inbox-view":"focus","aria-pressed":"false","title":"Focus view"},
                        "Focus"
                      ),
                      h("button", {"className":"view-choice","type":"button","data-inbox-view":"multi","aria-pressed":"false","title":"Multi chat view"},
                        "Multi"
                      )
                    ),
                    h("button", {"id":"inbox-refresh","className":"button ghost","type":"button"},
                      "Refresh"
                    )
                  )
                ),
                h("div", {"id":"inbox-shell","className":"chat-shell","data-view":"split"},
                  h("aside", {"className":"chat-list-panel","aria-label":"Message threads"},
                    h("input", {"id":"inbox-search","type":"search","placeholder":"Search messages or chats"}),
                    h("div", {"id":"inbox-thread-list","className":"chat-list"})
                  ),
                  h("section", {"className":"chat-panel","aria-label":"Selected conversation"},
                    h("div", {"id":"inbox-active-heading","className":"chat-heading"}),
                    h("div", {"id":"inbox-thread","className":"chat-thread"}),
                    h("form", {"id":"inbox-form","className":"chat-composer","noValidate":true},
                      h("textarea", {"id":"inbox-message","rows":"2","maxLength":"4096","placeholder":"Type a message"}),
                      h("button", {"id":"inbox-send-button","className":"button primary","type":"submit"},
                        "Send"
                      )
                    )
                  ),
                  h("section", {"id":"inbox-multi-board","className":"multi-chat-board","aria-label":"Multiple conversations"})
                ),
                h("p", {"id":"inbox-status","className":"status","role":"status","aria-live":"polite"})
              )
            ),
            h("section", {"id":"view-groups","className":"view","hidden":true},
              h("section", {"className":"panel","aria-labelledby":"groups-title"},
                h("div", {"className":"panel-heading"},
                  h("div", null,
                    h("p", {"className":"eyebrow"},
                      "Group management"
                    ),
                    h("h2", {"id":"groups-title"},
                      "Groups and members"
                    )
                  )
                ),
                h("div", {"className":"module-grid"},
                  h("form", {"id":"group-form","className":"stack","noValidate":true},
                    h("input", {"id":"group-id","type":"hidden"}),
                    h("label", {"htmlFor":"group-name"},
                      "Group name"
                    ),
                    h("input", {"id":"group-name","type":"text","required":true}),
                    h("label", {"htmlFor":"group-type"},
                      "Type"
                    ),
                    h("select", {"id":"group-type"},
                      h("option", null,
                        "Private"
                      ),
                      h("option", null,
                        "Public"
                      )
                    ),
                    h("label", {"htmlFor":"group-status"},
                      "Action status"
                    ),
                    h("select", {"id":"group-status"},
                      h("option", null,
                        "Created"
                      ),
                      h("option", null,
                        "Joined"
                      ),
                      h("option", null,
                        "Left"
                      ),
                      h("option", null,
                        "Archived"
                      )
                    ),
                    h("label", {"htmlFor":"group-members"},
                      "Members"
                    ),
                    h("textarea", {"id":"group-members","rows":"3","placeholder":"One @username or +91 number per line"}),
                    h("label", {"htmlFor":"group-notes"},
                      "Settings"
                    ),
                    h("textarea", {"id":"group-notes","rows":"3"}),
                    h("div", {"className":"button-row"},
                      h("button", {"className":"button primary","type":"submit"},
                        "Save group"
                      ),
                      h("button", {"id":"group-clear","className":"button ghost","type":"button"},
                        "Clear"
                      )
                    )
                  ),
                  h("div", {"id":"group-list","className":"record-list"})
                )
              )
            ),
            h("section", {"id":"view-channels","className":"view","hidden":true},
              h("section", {"className":"panel","aria-labelledby":"channels-title"},
                h("div", {"className":"panel-heading"},
                  h("div", null,
                    h("p", {"className":"eyebrow"},
                      "Channel management"
                    ),
                    h("h2", {"id":"channels-title"},
                      "Channels and invites"
                    )
                  )
                ),
                h("div", {"className":"module-grid"},
                  h("form", {"id":"channel-form","className":"stack","noValidate":true},
                    h("input", {"id":"channel-id","type":"hidden"}),
                    h("label", {"htmlFor":"channel-name"},
                      "Channel name"
                    ),
                    h("input", {"id":"channel-name","type":"text","required":true}),
                    h("label", {"htmlFor":"channel-privacy"},
                      "Privacy"
                    ),
                    h("select", {"id":"channel-privacy"},
                      h("option", null,
                        "Private"
                      ),
                      h("option", null,
                        "Public"
                      )
                    ),
                    h("label", {"htmlFor":"channel-invites"},
                      "Invite members"
                    ),
                    h("textarea", {"id":"channel-invites","rows":"3","placeholder":"One username per line"}),
                    h("label", {"htmlFor":"channel-notes"},
                      "Settings"
                    ),
                    h("textarea", {"id":"channel-notes","rows":"3"}),
                    h("div", {"className":"button-row"},
                      h("button", {"className":"button primary","type":"submit"},
                        "Save channel"
                      ),
                      h("button", {"id":"channel-clear","className":"button ghost","type":"button"},
                        "Clear"
                      )
                    )
                  ),
                  h("div", {"id":"channel-list","className":"record-list"})
                )
              )
            ),
            h("section", {"id":"view-posts","className":"view","hidden":true},
              h("div", {"className":"post-layout"},
                h("section", {"className":"panel","aria-labelledby":"post-editor-title"},
                  h("div", {"className":"panel-heading"},
                    h("div", null,
                      h("p", {"className":"eyebrow"},
                        "Posting manager"
                      ),
                      h("h2", {"id":"post-editor-title"},
                        "Create post"
                      )
                    )
                  ),
                  h("form", {"id":"post-form","className":"stack","noValidate":true},
                    h("input", {"id":"post-id","type":"hidden"}),
                    h("label", {"htmlFor":"post-title"},
                      "Post title"
                    ),
                    h("input", {"id":"post-title","type":"text","required":true}),
                    h("div", {"className":"form-grid"},
                      h("label", null,
                        "Type",
                        h("select", {"id":"post-type"},
                          h("option", {"value":"text"},
                            "Text only"
                          ),
                          h("option", {"value":"image"},
                            "Image + text"
                          ),
                          h("option", {"value":"video"},
                            "Video + text"
                          ),
                          h("option", {"value":"document"},
                            "Document"
                          ),
                          h("option", {"value":"audio"},
                            "Audio"
                          ),
                          h("option", {"value":"voice"},
                            "Voice message"
                          ),
                          h("option", {"value":"poll"},
                            "Poll"
                          ),
                          h("option", {"value":"quiz"},
                            "Quiz"
                          ),
                          h("option", {"value":"forwarded"},
                            "Forwarded message"
                          )
                        )
                      ),
                      h("label", null,
                        "Category",
                        h("input", {"id":"post-category","type":"text","placeholder":"Marketing"})
                      ),
                      h("label", null,
                        "Tags",
                        h("input", {"id":"post-tags","type":"text","placeholder":"date, offer, news"})
                      ),
                      h("label", null,
                        "Status",
                        h("select", {"id":"post-status"},
                          h("option", null,
                            "Draft"
                          ),
                          h("option", null,
                            "Ready"
                          ),
                          h("option", null,
                            "Scheduled"
                          ),
                          h("option", null,
                            "Posted"
                          )
                        )
                      )
                    ),
                    h("label", {"htmlFor":"post-scheduled-at"},
                      "Scheduled date"
                    ),
                    h("input", {"id":"post-scheduled-at","type":"datetime-local"}),
                    h("label", {"htmlFor":"post-media-url"},
                      "Media URL"
                    ),
                    h("input", {"id":"post-media-url","type":"url","placeholder":"https://example.com/media.jpg"}),
                    h("label", {"htmlFor":"post-body"},
                      "Text or caption"
                    ),
                    h("textarea", {"id":"post-body","rows":"6"}),
                    h("label", {"htmlFor":"post-recipient"},
                      "Manual posting target"
                    ),
                    h("input", {"id":"post-recipient","type":"text","placeholder":"@channel, @username, or chat"}),
                    h("label", null,
                      "Saved contacts"
                    ),
                    h("div", {"id":"post-contact-targets","className":"recipient-list"}),
                    h("label", null,
                      "Saved groups"
                    ),
                    h("div", {"id":"post-group-targets","className":"recipient-list"}),
                    h("div", {"className":"button-row"},
                      h("button", {"className":"button primary","type":"submit"},
                        "Save post"
                      ),
                      h("button", {"id":"post-send-now","className":"button ghost","type":"button"},
                        "Post now"
                      ),
                      h("button", {"id":"post-schedule","className":"button ghost","type":"button"},
                        "Schedule"
                      ),
                      h("button", {"id":"post-clear","className":"button text","type":"button"},
                        "Clear"
                      )
                    )
                  ),
                  h("p", {"id":"post-status-message","className":"status","role":"status","aria-live":"polite"})
                ),
                h("section", {"className":"panel","aria-labelledby":"post-preview-title"},
                  h("div", {"className":"panel-heading"},
                    h("div", null,
                      h("p", {"className":"eyebrow"},
                        "Preview"
                      ),
                      h("h2", {"id":"post-preview-title"},
                        "Post preview"
                      )
                    )
                  ),
                  h("div", {"id":"post-preview","className":"post-preview"})
                ),
                h("section", {"className":"panel post-list-panel","aria-labelledby":"post-list-title"},
                  h("div", {"className":"panel-heading"},
                    h("div", null,
                      h("p", {"className":"eyebrow"},
                        "Content library"
                      ),
                      h("h2", {"id":"post-list-title"},
                        "Saved posts"
                      )
                    )
                  ),
                  h("div", {"className":"toolbar"},
                    h("input", {"id":"post-search","type":"search","placeholder":"Search posts"}),
                    h("select", {"id":"post-filter-type"},
                      h("option", {"value":""},
                        "All types"
                      ),
                      h("option", {"value":"text"},
                        "Text"
                      ),
                      h("option", {"value":"image"},
                        "Image"
                      ),
                      h("option", {"value":"video"},
                        "Video"
                      ),
                      h("option", {"value":"poll"},
                        "Poll"
                      ),
                      h("option", {"value":"quiz"},
                        "Quiz"
                      )
                    ),
                    h("select", {"id":"post-sort"},
                      h("option", {"value":"created-desc"},
                        "Newest"
                      ),
                      h("option", {"value":"created-asc"},
                        "Oldest"
                      ),
                      h("option", {"value":"category"},
                        "Category"
                      ),
                      h("option", {"value":"scheduled"},
                        "Scheduled date"
                      )
                    )
                  ),
                  h("div", {"id":"post-list","className":"record-list"})
                )
              )
            ),
            h("section", {"id":"view-post-history","className":"view","hidden":true},
              h("div", {"className":"two-column"},
                h("section", {"className":"panel","aria-labelledby":"sent-post-history-title"},
                  h("div", {"className":"panel-heading"},
                    h("div", null,
                      h("p", {"className":"eyebrow"},
                        "Sharing details"
                      ),
                      h("h2", {"id":"sent-post-history-title"},
                        "Sent Posts"
                      )
                    )
                  ),
                  h("div", {"id":"post-history-sent","className":"record-list"})
                ),
                h("section", {"className":"panel","aria-labelledby":"pending-post-history-title"},
                  h("div", {"className":"panel-heading"},
                    h("div", null,
                      h("p", {"className":"eyebrow"},
                        "Post status"
                      ),
                      h("h2", {"id":"pending-post-history-title"},
                        "Pending / Not Yet Sent Posts"
                      )
                    )
                  ),
                  h("div", {"id":"post-history-pending","className":"record-list"})
                )
              )
            ),
            h("section", {"id":"view-search","className":"view","hidden":true},
              h("section", {"className":"panel","aria-labelledby":"search-title"},
                h("div", {"className":"panel-heading"},
                  h("div", null,
                    h("p", {"className":"eyebrow"},
                      "Search"
                    ),
                    h("h2", {"id":"search-title"},
                      "Workspace search"
                    )
                  )
                ),
                h("input", {"id":"global-search","type":"search","placeholder":"Search numbers, profiles, contacts, groups, channels, posts"}),
                h("div", {"id":"global-results","className":"record-list search-results"})
              )
            ),
            h("section", {"id":"view-configuration","className":"view","hidden":true},
              h("section", {"className":"panel","aria-labelledby":"configuration-title"},
                h("div", {"className":"panel-heading"},
                  h("div", null,
                    h("p", {"className":"eyebrow"},
                      "Preferences"
                    ),
                    h("h2", {"id":"configuration-title"},
                      "Workspace settings"
                    )
                  )
                ),
                h("form", {"id":"settings-form","className":"stack settings-grid","noValidate":true},
                  h("label", null,
                    "API settings",
                    h("input", {"id":"setting-api","type":"text","placeholder":"Server API"})
                  ),
                  h("label", null,
                    "Telegram configuration",
                    h("input", {"id":"setting-telegram","type":"text","placeholder":"Default Telegram workflow"})
                  ),
                  h("label", null,
                    "Session management",
                    h("select", {"id":"setting-session"},
                      h("option", null,
                        "Browser session"
                      ),
                      h("option", null,
                        "Short session"
                      ),
                      h("option", null,
                        "Manual logout only"
                      )
                    )
                  ),
                  h("label", null,
                    "Proxy settings",
                    h("input", {"id":"setting-proxy","type":"text","placeholder":"Proxy URL"})
                  ),
                  h("label", null,
                    "Storage settings",
                    h("select", {"id":"setting-storage"},
                      h("option", null,
                        "Browser local workspace"
                      ),
                      h("option", null,
                        "JSON files"
                      ),
                      h("option", null,
                        "Markdown files"
                      ),
                      h("option", null,
                        "Database later"
                      )
                    )
                  ),
                  h("label", null,
                    "General settings",
                    h("select", {"id":"setting-theme"},
                      h("option", null,
                        "Dark mode"
                      ),
                      h("option", null,
                        "Light mode"
                      )
                    )
                  ),
                  h("button", {"className":"button primary","type":"submit"},
                    "Save settings"
                  )
                ),
                h("p", {"id":"settings-status","className":"status","role":"status","aria-live":"polite"})
              )
            ),
            h("section", {"id":"view-backup","className":"view","hidden":true},
              h("section", {"className":"panel","aria-labelledby":"backup-title"},
                h("div", {"className":"panel-heading"},
                  h("div", null,
                    h("p", {"className":"eyebrow"},
                      "Backup and restore"
                    ),
                    h("h2", {"id":"backup-title"},
                      "Workspace JSON"
                    )
                  )
                ),
                h("div", {"className":"button-row"},
                  h("button", {"id":"backup-export","className":"button primary","type":"button"},
                    "Export backup"
                  ),
                  h("button", {"id":"backup-import","className":"button ghost","type":"button"},
                    "Restore backup"
                  )
                ),
                h("textarea", {"id":"backup-json","className":"code-box large","rows":"16","spellCheck":false}),
                h("p", {"id":"backup-status","className":"status","role":"status","aria-live":"polite"})
              )
            )
          )
        )
      ),
      h("aside", {"id":"telegram-guide-panel","className":"guide-panel","role":"complementary","aria-labelledby":"telegram-user-guide-title","hidden":true},
        h("div", {"className":"guide-dialog"},
          h("div", {"className":"guide-dialog-header"},
            h("div", null,
              h("p", {"className":"eyebrow"},
                "Help guide"
              ),
              h("h2", {"id":"telegram-user-guide-title"},
                "Telegram API setup"
              )
            ),
            h("button", {"className":"icon-button guide-close-button","type":"button","data-guide-close":"","aria-label":"Close help guide"},
              "X"
            )
          ),
          h("p", {"className":"guide-intro"},
            "Use these quick steps to create Telegram API credentials and connect your number."
          ),
          h("ol", {"className":"guide-steps"},
            h("li", null,
              h("span", null,
                "1"
              ),
              h("p", null,
                "Open ",
                h("a", {"href":"https://my.telegram.org/auth?to=apps","target":"_blank","rel":"noopener noreferrer"},
                  "my.telegram.org"
                ),
                "."
              )
            ),
            h("li", null,
              h("span", null,
                "2"
              ),
              h("div", null,
                h("p", null,
                  "Enter your Telegram phone number. For India, use ",
                  h("strong", null,
                    "+91"
                  ),
                  " before the number."
                ),
                h("a", {"className":"guide-screenshot","href":"/console/assets/guide/telegram-phone-entry.png","target":"_blank","rel":"noopener noreferrer","title":"Open the full-size screenshot"},
                  h("img", {"src":"/console/assets/guide/telegram-phone-entry.png","width":"1592","height":"563","alt":"Telegram website phone number entry screen","loading":"lazy","decoding":"async"})
                )
              )
            ),
            h("li", null,
              h("span", null,
                "3"
              ),
              h("div", null,
                h("p", null,
                  "Enter the confirmation code received in Telegram and click ",
                  h("strong", null,
                    "Sign in"
                  ),
                  "."
                ),
                h("a", {"className":"guide-screenshot","href":"/console/assets/guide/telegram-confirmation-redacted.png","target":"_blank","rel":"noopener noreferrer","title":"Open the full-size screenshot"},
                  h("img", {"src":"/console/assets/guide/telegram-confirmation-redacted.png","width":"1523","height":"667","alt":"Telegram website confirmation-code screen with a safe example phone number","loading":"lazy","decoding":"async"})
                )
              )
            ),
            h("li", null,
              h("span", null,
                "4"
              ),
              h("p", null,
                "Click ",
                h("a", {"href":"https://my.telegram.org/apps","target":"_blank","rel":"noopener noreferrer"},
                  "API development tools"
                ),
                "."
              )
            ),
            h("li", null,
              h("span", null,
                "5"
              ),
              h("div", null,
                h("p", null,
                  "Copy ",
                  h("strong", null,
                    "API ID"
                  ),
                  " and ",
                  h("strong", null,
                    "API hash"
                  ),
                  ", then paste them into this form."
                ),
                h("a", {"className":"guide-screenshot","href":"/console/assets/guide/telegram-api-credentials-redacted.png","target":"_blank","rel":"noopener noreferrer","title":"Open the full-size screenshot"},
                  h("img", {"src":"/console/assets/guide/telegram-api-credentials-redacted.png","width":"1601","height":"320","alt":"Telegram API configuration screen with the API ID and API hash blurred","loading":"lazy","decoding":"async"})
                )
              )
            ),
            h("li", null,
              h("span", null,
                "6"
              ),
              h("p", null,
                "Enter your phone number here, click ",
                h("strong", null,
                  "Send verification code"
                ),
                ", then enter the Telegram code."
              )
            )
          )
        )
      )
  );
}
