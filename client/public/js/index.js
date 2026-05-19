window.onload = function () {
  $('.voice_call_div').show();
};

toastr.options = {
  closeButton: false,
  debug: false,
  newestOnTop: false,
  progressBar: false,
  positionClass: 'toast-top-right',
  preventDuplicates: false,
  onclick: null,
  showDuration: '300',
  hideDuration: '1000',
  timeOut: '5000',
  extendedTimeOut: '1000',
  showEasing: 'swing',
  hideEasing: 'linear',
  showMethod: 'fadeIn',
  hideMethod: 'fadeOut',
};

function makeCall(details, callback) {
  const xhttp = new XMLHttpRequest();
  xhttp.onreadystatechange = function () {
    if (this.readyState === 4 && this.status >= 200) {
      const response = this.responseText;
      if (response.state === 'failed') {
        toastr.error(response.state);
      } else {
        callback(response);
      }
    }
  };
  xhttp.open('POST', './outbound-call/', true);
  xhttp.setRequestHeader('Content-Type', 'application/json');
  xhttp.send(JSON.stringify(details));
}

document.getElementById('voice_call_form').addEventListener('submit', (event) => {
  event.preventDefault();

  const messageEl = document.getElementById('message');
  messageEl.textContent = '';

  const retData = {
    from: document.getElementById('fromNumber').value.trim(),
    to: document.getElementById('toNumber').value.trim(),
    bridge_to: document.getElementById('bridgeToNumber').value.trim(),
    play_text: document.getElementById('promptMessage').value.trim(),
    play_voice: document.getElementById('voice').value,
    play_language: document.getElementById('language').value,
  };

  document.getElementById('joinRoom').disabled = true;
  document.getElementById('joinRoom').value = 'Calling...';

  makeCall(retData, (response) => {
    console.log(response);
    document.getElementById('joinRoom').disabled = false;
    document.getElementById('joinRoom').value = 'Call';
  });
});
