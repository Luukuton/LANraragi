/**
 * Functions for Generic API calls.
 */
const Server = {};

Server.isScriptRunning = false;

/**
 * Call that shows a popup to the user on success/failure.
 * Returns the promise so you can add final callbacks if needed.
 * @param {*} endpoint URL endpoint
 * @param {*} method GET/PUT/DELETE/POST
 * @param {*} successMessage Message written in the toast if request succeeded (success = 1)
 * @param {*} errorMessage Header of the error message if request fails (success = 0)
 * @param {*} successCallback called if request succeeded
 * @returns The result of the callback, or NULL.
 */
Server.callAPI = function (endpoint, method, successMessage, errorMessage, successCallback) {
    return fetch(endpoint, { method })
        .then((response) => (response.ok ? response.json() : { success: 0, error: "Response was not OK" }))
        .then((data) => {
            if (Object.prototype.hasOwnProperty.call(data, "success") && !data.success) {
                throw new Error(data.error);
            } else {
                if (successMessage !== null) {
                    $.toast({
                        showHideTransition: "slide",
                        position: "top-left",
                        loader: false,
                        heading: successMessage,
                        icon: "success",
                    });
                }

                if (successCallback !== null) return successCallback(data);

                return null;
            }
        })
        .catch((error) => LRR.showErrorToast(errorMessage, error));
};

/**
 * Check the status of a Minion job until it's completed.
 * @param {*} jobId Job ID to check
 * @param {*} callback Execute a callback on successful job completion.
 * @param {*} failureCallback Execute a callback on unsuccessful job completion.
 */
Server.checkJobStatus = function (jobId, callback, failureCallback) {
    fetch(`/api/minion/${jobId}`, { method: "GET" })
        .then((response) => (response.ok ? response.json() : { success: 0, error: "Response was not OK" }))
        .then((data) => {
            if (data.error) throw new Error(data.error);

            if (data.state === "failed") {
                throw new Error(data.result);
            }

            if (data.state !== "finished") {
                // Wait and retry, job isn't done yet
                setTimeout(() => {
                    Server.checkJobStatus(jobId, callback, failureCallback);
                }, 1000);
            } else {
                // Update UI with info
                callback(data);
            }
        })
        .catch((error) => { LRR.showErrorToast("Error checking Minion job status", error); failureCallback(error); });
};

/**
 * POSTs the data of the specified form to the page.
 * This is used for Edit, Config and Plugins.
 * @param {*} formSelector The form to POST
 * @returns the promise object so you can chain more callbacks.
 */
Server.saveFormData = function (formSelector) {
    const postData = new FormData($(formSelector)[0]);

    return fetch(window.location.href, { method: "POST", body: postData })
        .then((response) => (response.ok ? response.json() : { success: 0, error: "Response was not OK" }))
        .then((data) => {
            if (data.success) {
                $.toast({
                    showHideTransition: "slide",
                    position: "top-left",
                    loader: false,
                    heading: "Saved Successfully!",
                    icon: "success",
                });
            } else {
                throw new Error(data.message);
            }
        })
        .catch((error) => LRR.showErrorToast("Error while saving", error));
};

Server.triggerScript = function (namespace) {
    const scriptArg = $(`#${namespace}_ARG`).val();

    if (Server.isScriptRunning) {
        LRR.showErrorToast("A script is already running.", "Please wait for it to terminate.");
        return;
    }

    Server.isScriptRunning = true;
    $(".script-running").show();
    $(".stdbtn").hide();

    // Save data before triggering script
    Server.saveFormData("#editPluginForm")
        .then(Server.callAPI(`/api/plugins/queue?plugin=${namespace}&arg=${scriptArg}`, "POST", null, "Error while executing Script :",
            (data) => {
                // Check minion job state periodically while we're on this page
                Server.checkJobStatus(data.job,
                    (d) => {
                        Server.isScriptRunning = false;
                        $(".script-running").hide();
                        $(".stdbtn").show();

                        if (d.result.success === 1) {
                            $.toast({
                                showHideTransition: "slide",
                                position: "top-left",
                                loader: false,
                                heading: "Script result",
                                text: `<pre>${JSON.stringify(d.result.data, null, 4)}</pre>`,
                                hideAfter: false,
                                icon: "info",
                            });
                        } else LRR.showErrorToast(`Script failed: ${d.result.error}`);
                    },
                    () => {
                        Server.isScriptRunning = false;
                        $(".script-running").hide();
                        $(".stdbtn").show();
                    });
            }));
};

Server.cleanTemporaryFolder = function () {
    Server.callAPI("/api/tempfolder", "DELETE", "Temporary Folder Cleaned!", "Error while cleaning Temporary Folder :",
        (data) => {
            $("#tempsize").html(data.newsize);
        });
};

Server.invalidateCache = function () {
    Server.callAPI("/api/search/cache", "DELETE", "Threw away the Search Cache!", "Error while deleting cache! Check Logs.", null);
};

Server.clearAllNewFlags = function () {
    Server.callAPI("/api/database/isnew", "DELETE", "All archives are no longer new!", "Error while clearing flags! Check Logs.", null);
};

Server.dropDatabase = function () {
    if (confirm("Danger! Are you *sure* you want to do this?")) {
        Server.callAPI("/api/database/drop", "POST", "Sayonara! Redirecting you...", "Error while resetting the database? Check Logs.",
            () => {
                setTimeout(() => { document.location.href = "./"; }, 1500);
            });
    }
};

Server.cleanDatabase = function () {
    Server.callAPI("/api/database/clean", "POST", null, "Error while cleaning the database! Check Logs.",
        (data) => {
            $.toast({
                showHideTransition: "slide",
                position: "top-left",
                loader: false,
                heading: `Successfully cleaned the database and removed ${data.deleted} entries!`,
                icon: "success",
            });

            if (data.unlinked > 0) {
                $.toast({
                    showHideTransition: "slide",
                    position: "top-left",
                    loader: false,
                    heading: `${data.unlinked} other entries have been unlinked from the database and will be deleted on the next cleanup! <br>Do a backup now if some files disappeared from your archive index.`,
                    hideAfter: false,
                    icon: "warning",
                });
            }
        });
};

Server.regenerateThumbnails = function (force) {
    const forceparam = force ? 1 : 0;
    Server.callAPI(`/api/regen_thumbs?force=${forceparam}`, "POST",
        "Queued up a job to regenerate thumbnails! Stay tuned for updates or check the Minion console.", "Error while sending job to Minion:",
        (data) => {
            // Disable the buttons to avoid accidental double-clicks.
            $("#genthumb-button").prop("disabled", true);
            $("#forcethumb-button").prop("disabled", true);

            // Check minion job state periodically while we're on this page
            Server.checkJobStatus(data.job,
                (d) => {
                    $("#genthumb-button").prop("disabled", false);
                    $("#forcethumb-button").prop("disabled", false);
                    $.toast({
                        showHideTransition: "slide",
                        position: "top-left",
                        loader: false,
                        heading: "All thumbnails generated! Encountered the following errors:",
                        text: d.result.errors,
                        hideAfter: false,
                        icon: "success",
                    });
                },
                (error) => {
                    $("#genthumb-button").prop("disabled", false);
                    $("#forcethumb-button").prop("disabled", false);
                    LRR.showErrorToast("The thumbnail regen job failed!", error);
                });
        });
};

// Adds an archive to a category. Basic implementation to use everywhere.
Server.addArchiveToCategory = function (arcId, catId) {
    Server.callAPI(`/api/categories/${catId}/${arcId}`, "PUT", `Added ${arcId} to Category ${catId}!`, "Error adding/removing archive to category", null);
};

// Ditto, but for removing.
Server.removeArchiveFromCategory = function (arcId, catId) {
    Server.callAPI(`/api/categories/${catId}/${arcId}`, "DELETE", `Removed ${arcId} from Category ${catId}!`, "Error adding/removing archive to category", null);
};

/**
 * Sends a DELETE request for that archive ID,
 * deleting the Redis key and attempting to delete the archive file.
 * @param {*} arcId Archive ID
 * @param {*} callback Callback to execute once the archive is deleted (usually a redirection)
 */
Server.deleteArchive = function (arcId, callback) {
    fetch(`/api/archives/${arcId}`, { method: "DELETE" })
        .then((response) => (response.ok ? response.json() : { success: 0, error: "Response was not OK" }))
        .then((data) => {
            if (data.success === "0") {
                $.toast({
                    showHideTransition: "slide",
                    position: "top-left",
                    loader: false,
                    heading: "Couldn't delete archive file. <br> (Maybe it has already been deleted beforehand?)",
                    text: "Archive metadata has been deleted properly. <br> Please delete the file manually before returning to Library View.",
                    hideAfter: false,
                    icon: "warning",
                });
                $(".stdbtn").hide();
                $("#goback").show();
            } else {
                $.toast({
                    showHideTransition: "slide",
                    position: "top-left",
                    loader: false,
                    heading: "Archive successfully deleted. Redirecting you ...",
                    text: `File name : ${data.filename}`,
                    icon: "success",
                });
                setTimeout(callback, 1500);
            }
        })
        .catch((error) => LRR.showErrorToast("Error while deleting archive", error));
};
