package app.zeze.hanzirush;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.games.GamesSignInClient;
import com.google.android.gms.games.PlayGames;
import com.google.android.gms.games.PlayGamesSdk;

/**
 * Play Games Services v2 sign-in for src/core/signin.ts: hands JS a one-time server auth code that the backend
 * exchanges for the Play Games player id (server/oidc.ts). Off unless the build sets PLAY_GAMES_APP_ID
 * (android/app/build.gradle), so builds without a Play Console game still run.
 */
@CapacitorPlugin(name = "PlayGames")
public class PlayGamesPlugin extends Plugin {

    private boolean ready = false;

    @Override
    public void load() {
        String appId = getContext().getString(R.string.game_services_project_id).trim();
        if (appId.isEmpty()) return;
        try {
            PlayGamesSdk.initialize(getContext());
            ready = true;
        } catch (Exception e) {
            ready = false;
        }
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject r = new JSObject();
        r.put("available", ready);
        call.resolve(r);
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        String clientId = call.getString("serverClientId", "");
        if (!ready) {
            call.reject("Play Games is not configured", "UNAVAILABLE");
            return;
        }
        if (clientId == null || clientId.isEmpty()) {
            call.reject("serverClientId is required");
            return;
        }
        GamesSignInClient client = PlayGames.getGamesSignInClient(getActivity());
        client.isAuthenticated().addOnCompleteListener(auth -> {
            if (auth.isSuccessful() && auth.getResult().isAuthenticated()) {
                requestCode(client, clientId, call);
                return;
            }
            // not signed in yet (or auto sign-in was declined): show Play Games' own sign-in
            client.signIn().addOnCompleteListener(s -> {
                if (s.isSuccessful() && s.getResult().isAuthenticated()) requestCode(client, clientId, call);
                else call.reject("Play Games sign-in was cancelled", "CANCELLED");
            });
        });
    }

    private void requestCode(GamesSignInClient client, String clientId, PluginCall call) {
        client.requestServerSideAccess(clientId, false).addOnCompleteListener(t -> {
            String code = t.isSuccessful() ? t.getResult() : null;
            if (code == null || code.isEmpty()) {
                call.reject("Could not get a Play Games server auth code", "FAILED", t.getException());
                return;
            }
            JSObject r = new JSObject();
            r.put("serverAuthCode", code);
            call.resolve(r);
        });
    }
}
