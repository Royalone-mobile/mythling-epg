/*! mythling-epg v1.2.1
 *  Copyright 2015 Donald Oakes
 *  License: Apache-2.0 */
'use strict';

var epgApp = angular.module('epgApp', ['epgSearch', 'epgCalendar', 'infinite-scroll', 'stay', 'ui.bootstrap']);

epgApp.constant('ERROR_TAG', 'ERROR: ');
epgApp.value('RECORD_STATUSES', [
  // from programtypes.h
  { status: 'Failing', code: -14, record: false, error: true, description: 'Failing',
    actions: ['dont', 'never', 'remove'] },
  { status: 'MissedFuture', code: -11, record: false, error: true, description: 'Missed Future',
    actions: ['dont', 'never', 'remove'] },
  { status: 'Tuning', code: -10, record: true, error: false, description: 'Tuning',
    actions: ['dont', 'never', 'remove'] },
  { status: 'Failed', code: -9, record: false, error: true, description: 'Failed',
    actions: ['dont', 'never', 'remove'] },
  { status: 'TunerBusy', code: -8, record: false, error: true, description: 'Tuner Busy',
    actions: ['dont', 'never', 'remove'] },
  { status: 'LowDiskSpace', code: -7, record: false, error: true, description: 'Low Disk Space',
    actions: ['dont', 'never', 'remove'] },
  { status: 'Cancelled', code: -6, record: false, error: false, description: 'Cancelled',
    actions: ['dont', 'never', 'remove'] },
  { status: 'Missed', code: -5, record: false, error: false, description: 'Missed',
    actions: ['dont', 'never', 'remove'] },
  { status: 'Aborted', code: -4, record: false, error: false, description: 'Aborted',
    actions: ['dont', 'never', 'remove'] },
  { status: 'Recorded', code: -3, record: true, error: false, description: 'Recorded',
    actions: ['dont', 'never', 'remove'] },
  { status: 'Recording', code: -2, record: true, error: false, description: 'Recording',
    actions: ['dont', 'never', 'remove'] },
  { status: 'WillRecord', code: -1, record: true, error: false, description: 'Will Record',
    actions: ['dont', 'never', 'remove'] },
  { status: 'Unknown', code: 0, record: false, error: false, description: '',
    actions: ['single', 'transcode', 'all'] },
  { status: 'DontRecord', code: 1, record: false, error: false, description: "Don't Record",
    actions: ['single', 'transcode', 'all'] },
  { status: 'PreviousRecording', code: 2, record: false, error: false, description: 'Previous Recording',
    actions: ['single', 'transcode', 'remove'] },
  { status: 'CurrentRecording', code: 3, record: false, error: false, description: 'Current Recording',
    actions: ['single', 'transcode', 'remove'] },
  { status: 'EarlierShowing', code: 4, record: false, error: false, description: 'Earlier Showing',
    actions: ['single', 'transcode', 'remove'] },
  { status: 'TooManyRecordings', code: 5, record: false, error: false, description: 'Too Many Recordings',
    actions: ['single', 'transcode', 'remove'] },
  { status: 'NotListed', code: 6, record: false, error: true, description: 'Not Listed',
    actions: [] },
  { status: 'Conflict', code: 7, record: false, error: false, description: 'Conflict',
    actions: ['dont', 'never', 'remove'] },
  { status: 'LaterShowing', code: 8, record: false, error: false, description: 'Later Showing',
    actions: ['dont', 'never', 'remove'] },
  { status: 'Repeat', code: 9, record: false, error: false, description: 'Repeat',
    actions: ['dont', 'never', 'remove'] },
  { status: 'Inactive', code: 10, record: false, error: false, description: 'Inactive',
    actions: ['single', 'transcode', 'all'] },
  { status: 'NeverRecord', code: 11, record: false, error: false, description: 'Never Record',
    actions: ['single', 'transcode', 'all'] },
  { status: 'Offline', code: 12, record: false, error: true, description: 'Recorder Offline',
    actions: [] }
]);

epgApp.config(['$compileProvider', function($compileProvider) {
  var debugInfo = 'true' == urlParams().angularDebug;
  $compileProvider.debugInfoEnabled(debugInfo);
}]);

epgApp.config(['$httpProvider', function($httpProvider) {
  $httpProvider.defaults.headers.get = { 'Accept' : 'application/json' };
  $httpProvider.interceptors.push(function() {
    return {
      'request': function(config) {
        config.requestTimestamp = new Date().getTime();
        return config;
      },
      'response': function(response) {
        response.config.responseTime = new Date().getTime() - response.config.requestTimestamp;
        return response;
      }
    };
  });
}]);

epgApp.config(['$tooltipProvider', function($tooltipProvider) {
  $tooltipProvider.setTriggers({'popShow': 'popHide'});
}]);

epgApp.controller('EpgController', 
    ['$scope', '$window', '$http', '$timeout', '$location', '$modal', '$filter', 'GuideData', 'RECORD_STATUSES', 
    function($scope, $window, $http, $timeout, $location, $modal, $filter, GuideData, RECORD_STATUSES) {

  // layout dimensions
  for (var i = 0; i < $window.document.styleSheets.length; i++) {
    var sheet = $window.document.styleSheets[i];
    if (sheet.href !== null && sheet.href.endsWith('mythling.css'))  { // allows override (my-mythling.css)
      for (var j = 0; j < sheet.cssRules.length; j++) {
        var rule = sheet.cssRules[j];
        if (rule.selectorText === '.slot-width')
          $scope.slotWidth = parseCssDim(rule.style.width);
        else if (rule.selectorText === '.header-height')
          $scope.headerHeight = parseCssDim(rule.style.height);
        else if (rule.selectorText === '.label-width')
          $scope.labelWidth = parseCssDim(rule.style.width);
        else if (rule.selectorText === '.row-height')
          $scope.rowHeight = parseCssDim(rule.style.height);
      }
    }
  }

  var params = urlParams();
  // supportedParams
  var startTime = params.startTime ? new Date(params.startTime) : new Date();
  startTime = params.StartTime ? new Date(params.StartTime) : startTime; // support MythTV param name
  var guideInterval = params.guideInterval ? parseInt(params.guideInterval) : 12; // hours
  var guideHistory = params.guideHistory ? parseInt(params.guideHistory) : 0; // hours (must be less than interval)
  $scope.bufferSize = params.bufferSize ? parseInt(params.bufferSize) : 8; // screen widths (say, around 2 hours per)
  var awaitPrime = params.awaitPrime ? params.awaitPrime == 'true' : false; // whether to disable mobile scroll until loaded
  var channelGroupId = params.channelGroupId ? parseInt(params.channelGroupId) : 0;
  var mythlingServices = params.mythlingServices ? params.mythlingServices == 'true' : false;
  var demoMode = params.demoMode ? params.demoMode == 'true' : false;
  $scope.revertLabelsToFixed = params.revertLabelsToFixed ? parseInt(params.revertLabelsToFixed) : 0; // ms till revert to fixed
  epgDebug = params.epgDebug ? params.epgDebug == 'true' : false;
  
  if (epgDebug) {
    console.log('userAgent: ' + $window.navigator.userAgent);
    console.log('location: ' + $window.location);
    console.log('startTime: ' + startTime);
  }
  
  $scope.guideData = new GuideData(startTime, $scope.slotWidth, guideInterval, awaitPrime, guideHistory, channelGroupId, mythlingServices, demoMode);
  
  // takes either code or status as input for futureproofing
  // TODO: make this into a service so it can be used by GuideData
  $scope.recordStatus = function(input) {
    var recCode = parseInt(input);
    if (isNaN(recCode)) {
      for (var i = 0; i < RECORD_STATUSES.length; i++) {
        if (RECORD_STATUSES[i].status == input)
          return RECORD_STATUSES[i];
      }
    }
    else {
      for (var j = 0; j < RECORD_STATUSES.length; j++) {
        if (RECORD_STATUSES[j].code == recCode)
          return RECORD_STATUSES[j];
      }
    }
  };
  
  $scope.setPosition = function(offset) {
    var slots = Math.floor(offset / $scope.slotWidth);
    var newCurDate = new Date($scope.guideData.beginTime.getTime() + slots * 1800000);
    if (newCurDate.getTime() != $scope.guideData.curDate.getTime()) {
      $scope.guideData.curDate = newCurDate;
      if (!$scope.guideData.busy)
        angular.element(document.getElementById('calendarInput')).val($filter('date')($scope.guideData.curDate, 'EEE MMM d'));
    }
  };
  setPosition = $scope.setPosition;
  
  $scope.popElem = null;
  $scope.setPopElem = function(elem) {
    $scope.popElem = elem;
    elem.children(0).addClass('program-select');
  };
  $scope.popHide = function() {
    if ($scope.popElem !== null) {
      $scope.popElem.triggerHandler('popHide');
      $scope.popElem.children(0).removeClass('program-select');
      $scope.popElem = null;
      $scope.fireEpgAction('close.menu');
    }
  };
  popHide = $scope.popHide;
  
  $scope.popPlace = "top";
  $scope.setPopPlace = function(place) {
    $scope.popPlace = place;
  };
  
  var win = angular.element($window); 
  win.bind('click', $scope.popHide);
  win.bind('scroll', $scope.popHide);
  win.bind('resize', $scope.popHide);
  
  $scope.$on('$destroy', function() {
    win.unbind('click', $scope.popHide);
    win.unbind('scroll', $scope.popHide);
    win.unbind('resize', $scope.popHide);
  });
  
  
  // TODO make details a service
  $scope.details = function(program) {
    // TODO: better way to keep element showing selected
    $timeout(function() {
      angular.element(document.getElementById(program.id)).addClass('program-select');
    }, 0);
    
    $scope.fireEpgAction('open.details');
    
    if ($scope.guideData.demoMode) {
      $scope.program = program;
      var modalInstance = $modal.open({
        animation: false,
        templateUrl: 'views/details.html',
        controller: 'EpgModalController',
        scope: $scope
      });
      modalInstance.result.catch(function() {
        // TODO: better way and don't duplicate below
        $timeout(function() {
          var progElem = document.getElementById(program.id);
          angular.element(progElem).removeClass('program-select');
          progElem.focus();
          $scope.fireEpgAction('close.details');          
        }, 0);    
      });
      return;
    }
    
    var url = '/Guide/GetProgramDetails?ChanId=' + program.channel.ChanId + '&StartTime=' + program.StartTime;
    if (epgDebug)
      console.log('details url: ' + url);
    $http.get(url).success(function(data) {
      var Program = data.Program;
      if (Program.Description)
        program.description = Program.Description.replace('``', '"');
      if (Program.Airdate && "true" === Program.Repeat) {
        var oad = Program.Airdate;
        var d = new Date();
        d.setFullYear(parseInt(oad.substring(0, oad.indexOf('-'))));
        d.setMonth(parseInt(oad.substring(oad.indexOf('-') + 1, oad.lastIndexOf('-'))) - 1);
        d.setDate(parseInt(oad.substring(oad.lastIndexOf('-') + 1)));
        d.setHours(0);
        d.setMinutes(0);
        d.setSeconds(0);
        d.setMilliseconds(0);
        program.originalAirDate = d;
      }
      if (Program.Category)
        program.category = Program.Category;
      if (Program.Season && Program.Season != '0')
        program.season = parseInt(Program.Season);
      if (Program.Episode && Program.Episode != '0')
        program.episode = parseInt(Program.Episode);
      if (Program.Stars && Program.Stars != '0')
        program.rating = Math.round(parseFloat(Program.Stars)*5);
        
      if (Program.Cast && Program.Cast.CastMembers) {
        var directors = '';
        var actors = '';
        for (var i = 0; i < Program.Cast.CastMembers.length; i++) {
          var castMember = Program.Cast.CastMembers[i];
          if (castMember.Role == 'director')
            directors += castMember.Name + ', ';
          else if (castMember.Role == 'actor' || castMember.Role == 'guest_star')
            actors += castMember.Name + ', ';
        }
        if (directors !== '')
          program.directors = directors.substring(0, directors.length - 2);
        if (actors !== '')
          program.actors = actors.substring(0, actors.length - 2);
      }
      
      if (Program.Recording && Program.Recording.Status) {
        var statusCode = parseInt(Program.Recording.Status);
        program.recStatus = $scope.recordStatus(statusCode);
      }

      $scope.program = program;
      var modalInstance = $modal.open({
        animation: false,
        templateUrl: 'views/details.html',
        controller: 'EpgModalController',
        scope: $scope
      });
      
      modalInstance.result.catch(function() {
        // TODO: better way
        $timeout(function() {
          var progElem = document.getElementById(program.id);
          angular.element(progElem).removeClass('program-select');
          progElem.focus();
          $scope.fireEpgAction('close.details');    
        }, 0);    
      });
    });
  };
  
  $scope.fireEpgAction = function(name) {
    if (typeof CustomEvent == 'function')
      if (epgDebug)
        console.log('firing epgAction: ' + name);
      document.dispatchEvent(new CustomEvent('epgAction', {'detail': name})); // enable outside listeners
  };
  
  if ($scope.bufferSize === 0)
    $scope.guideData.nextPage();
  
}]);

epgApp.controller('EpgModalController', ['$scope', '$timeout', '$modalInstance', function($scope, $timeout, $modalInstance) {
  $scope.close = function(program) {
    $modalInstance.dismiss('close');
  };
}]);

epgApp.directive('popClick', ['$timeout', function($timeout) {
  return {
    restrict: 'A',
    link: function link(scope, elem, attrs) {
      
      var popHandler = function() {
        if (scope.popElem != elem) {
          // calculate placement
          var viewportOffset = elem[0].getBoundingClientRect();
          var topRoom = viewportOffset.top;
          var btmRoom = document.documentElement.clientHeight - viewportOffset.bottom;
          var leftRoom = viewportOffset.left;
          var rightRoom = document.documentElement.clientWidth - viewportOffset.right;
          var topClose = topRoom < 120;
          var btmClose = btmRoom < 120;
          var leftClose = leftRoom < 155;
          var rightClose = rightRoom < 155;
          // leftVClose and rightVClose mean there's no room to display menu on top or bottom
          var leftVClose = leftRoom + elem[0].offsetWidth/2 < 80;
          var rightVClose = document.documentElement.clientWidth - viewportOffset.left - elem[0].offsetWidth/2 < 80;
          var leftXorRightClose = (leftVClose || rightVClose) && !(leftVClose && rightVClose);
          var place = 'top';
          if (topClose || leftXorRightClose) {
            if (btmRoom > topRoom)
              place = 'bottom';
            if (btmClose || leftXorRightClose) {
              if (leftClose && !rightClose)
                place = 'right';
              else if (rightClose && !leftClose)
                place = 'left';
            }
          }

          scope.setPopPlace(place);
          scope.$apply();

          $timeout(function() {
            if (scope.popElem === null) {
              elem.triggerHandler('popShow');
              scope.setPopElem(elem);
              scope.fireEpgAction('open.menu');
            }
          }, 0);
        }
      };

      var keyHandler = function(event) {
        if (event.which === 13) {
          event.preventDefault();
          if (scope.popElem === elem)
            popHide();
          else
            popHandler();
        }
      };
      
      elem.bind('click', popHandler);
      elem.bind('keypress', keyHandler);
      
      scope.$on('$destroy', function() {
        elem.unbind('click', popHandler);
        elem.unbind('keypress', keyHandler);
      });
    }
  };
}]);

epgApp.directive('popHide', ['$timeout', function($timeout) {
  return {
    restrict: 'A',
    link: function link(scope, elem, attrs) {
      var blurHandler = function(event) {
        scope.popHide();
      };
      
      elem.bind('blur', blurHandler);
      scope.$on('$destroy', function() {
        elem.unbind('blur', blurHandler);
      });
    }
  };
}]);

epgApp.directive('onEnter', function() {
  return {
    restrict: 'A',
    link: function link(scope, elem, attrs) {
      
      var keyHandler = function(event) {
        if (event.which === 13) {
          scope.$apply(function() {
            scope.$eval(attrs.onEnter);
          });
          event.preventDefault();
        }
      };
      
      elem.bind('keypress', keyHandler);
      scope.$on('$destroy', function() {
        elem.unbind('click', keyHandler);
      });
    }
  };
});

epgApp.directive('focusMe', function() {
  var focusMeLaters = {};
  return {
    restrict: 'A',
    link: function link(scope, elem, attrs) {
      if (attrs.focusMe == 'later') {
        if (focusMeLaters[elem[0].id])
          elem[0].focus();
        else
          focusMeLaters[elem[0].id] = true;
      }
      else {
        elem[0].focus();
      }
    }
  };
});

epgApp.directive('blurMe', function() {
  return {
    restrict: 'A',
    link: function link(scope, elem, attrs) {

      var focusHandler = function() {
        elem[0].blur();
      };
      
      elem.bind('focus', focusHandler);
      scope.$on('$destroy', function() {
        elem.unbind('focus', focusHandler);
      });
    }
  };
});

epgApp.directive('epgRecord', ['$http', '$timeout', 'ERROR_TAG', 'RECORD_STATUSES', function($http, $timeout, ERROR_TAG, RECORD_STATUSES) {
  return {
    restrict: 'A',
    link: function link(scope, elem, attrs) {
      var clickHandler = function() {
        var action = attrs.epgRecord;
        // TODO use a controller -- this MUST be refactored
        var url = '/Dvr/';
        if (action == 'single' || action == 'transcode' || action == 'all') {
          url += 'AddRecordSchedule?' + 
              'ChanId=' + scope.program.channel.ChanId + '&' +
              'Station=' + scope.program.channel.CallSign + '&' + 
              'StartTime=' + scope.program.StartTime + '&' + 
              'EndTime=' + scope.program.EndTime + '&' + 
              'Type=' + (action == 'transcode' ? 'single' : action) + '&' + 
              'Title=' + encodeURI(scope.program.Title) + '&' + 
              'FindDay=0&FindTime=00:00:00';
        }
        else if (action == 'dont' || action == 'never') {
          url += 'AddDontRecordSchedule?' + 
              'ChanId=' + scope.program.channel.ChanId + '&' + 
              'StartTime=' + scope.program.StartTime; 
        }
        else if (action == 'remove') {
          url += 'GetRecordSchedule?' + 
              'ChanId=' + scope.program.channel.ChanId + '&' + 
              'StartTime=' + scope.program.StartTime; 
        }
        
        if (action == 'never')
          url += 'NeverRecord=true';
        
        if (action == 'transcode')
          url += '&AutoTranscode=true';

        if (epgDebug)
          console.log('record action url: ' + url);
        if (scope.guideData.demoMode) {
          if ((action == 'single' || action == 'transcode' || action == 'all'))
            scope.program.recStatus = RECORD_STATUSES[11];
          else
            scope.program.recStatus = RECORD_STATUSES[12];
        }
        else {
          $http.post(url).success(function(data, status, headers, config) {
            if (action == 'remove') {
              var recId = data.RecRule.Id;
              url = '/Dvr/RemoveRecordSchedule?RecordId=' + recId;
              if (epgDebug)
                console.log('remove recording schedule url: ' + url);
              $http.post(url).success(function(data, status, headers, config) {
                $timeout(function() {
                  var upcomingUrl = '/Dvr/GetUpcomingList?ShowAll=true';
                  $http.get(upcomingUrl).success(function(data, status, headers, config) {
                    if (epgDebug)
                      console.log('upcoming list response time: ' + config.responseTime);
                    // update all guide data for matching titles per upcoming recordings (consider omitting title match) 
                    var upcoming = data.ProgramList.Programs;
                    var upcomingForTitle = [];
                    for (var i = 0; i < upcoming.length; i++) {
                      if (upcoming[i].Title == scope.program.Title)
                        upcomingForTitle.push(upcoming[i]);
                    }
                    for (var chanNum in scope.guideData.channels) {
                      for (var startTime in scope.guideData.channels[chanNum].programs) {
                        var prog = scope.guideData.channels[chanNum].programs[startTime];
                        if (prog.Title == scope.program.Title) {
                          var foundUpcoming = null;
                          for (var j = 0; j < upcomingForTitle.length; j++) {
                            var upProg = upcomingForTitle[j];
                            if (upProg.StartTime == prog.StartTime && upProg.Channel.ChanId == prog.channel.ChanId) {
                              foundUpcoming = upProg;
                            }
                          }
                          if (foundUpcoming === null)
                            prog.recStatus = RECORD_STATUSES[12];
                          else
                            prog.recStatus = scope.recordStatus(foundUpcoming.Recording.Status);
                        }
                      }
                    }
                  }).error(function(data, status) {
                    console.log(ERROR_TAG + 'HTTP ' + status + ': ' + url);
                  });
                }, 500);
              }).error(function(data, status) {
                console.log(ERROR_TAG + 'HTTP ' + status + ': ' + url);
              });
            }
            else {
              $timeout(function() {
                var upcomingUrl = '/Dvr/GetUpcomingList?ShowAll=true';
                $http.get(upcomingUrl).success(function(data, status, headers, config) {
                  if (epgDebug)
                    console.log('upcoming list response time: ' + config.responseTime);
                  // update recording status for all matching programs in upcoming recordings
                  var upcoming = data.ProgramList.Programs;
                  for (var i = 0; i < upcoming.length; i++) {
                    var upProg = upcoming[i];
                    if (upProg.Title == scope.program.Title) {
                      var chanNum = scope.guideData.getChanNumIndex(upProg.Channel);
                      var chan = scope.guideData.channels[chanNum];
                      if (chan) {
                        var prog = chan.programs[upProg.StartTime];
                        if (prog && prog.Title == upProg.Title) {
                          prog.recStatus = scope.recordStatus(upProg.Recording.Status);
                        }
                      }
                    }
                  }
                }).error(function(data, status) {
                  console.log(ERROR_TAG + 'HTTP ' + status + ': ' + url);
                });
              }, 500);
            }
          }).error(function(data, status) {
            console.log(ERROR_TAG + 'HTTP ' + status + ': ' + url);
          });
        }
      };
      
      elem.bind('click', clickHandler);
      
      scope.$on('$destroy', function() {
        elem.unbind('click', clickHandler);
      });
    }
  };
}]);

// GuideData constructor function to encapsulate HTTP and pagination logic
epgApp.factory('GuideData', ['$http', '$timeout', '$window', '$filter', 'ERROR_TAG', 'RECORD_STATUSES', function($http, $timeout, $window, $filter, ERROR_TAG, RECORD_STATUSES) {
  var GuideData = function(startDate, slotWidth, intervalHours, awaitPrime, historyHours, channelGroupId, mythlingServices, demoMode) {
    
    this.slotWidth = slotWidth; // width of 1/2 hour
    
    this.interval = intervalHours * 3600000; // how much data to retrieve at a time
    this.history = historyHours * 3600000;
    
    if (channelGroupId)
      this.channelGroupId = channelGroupId;

    this.busy = false;
    this.prescrolled = false;

    this.preventMobileScroll = function(e) {
      e.preventDefault();
    };
    
    // startTime is where epg data retrieval begins
    this.setStartTime(startDate);
    // zeroTime is the absolute beginning from first request
    this.zeroTime = new Date(this.startTime);
    this.awaitPrime = awaitPrime;
    this.mythlingServices = mythlingServices;
    this.demoMode = demoMode;
  };

  GuideData.prototype.setStartTime = function(startTime) {

    if (epgDebug)
      console.log('startTime: ' + startTime.toISOString());
    
    this.curDate = new Date(startTime);
    
    this.channels = {};

    this.startTime = new Date(startTime);
    this.startTime.setTime(this.startTime.getTime() - this.history);
    // nearest half-hour
    this.startTime.setMinutes(this.startTime.getMinutes() >= 30 ? 30 : 0);
    this.startTime.setSeconds(0);
    this.startTime.setMilliseconds(0);
    this.endTime = new Date(this.startTime.getTime() + this.interval);
    // beginTime is where startTime was set before any scrolling
    this.beginTime = new Date(this.startTime);
    this.timeslots = [];
    
    this.index = 10;
  };
  
  // programId = to select, scrollTime = scroll to this time (should be in same day as this.startTime)
  GuideData.prototype.nextPage = function(programId, scrollTime) {
    if (this.busy)
      return;
    this.busy = true;
    
    if (scrollTime && scrollTime !== null)
      this.endTime = new Date(this.startTime.getTime() + 24*3600000); // cover one day
    
    var start = this.startTime.toISOString();
    var end = this.endTime.toISOString();
    
    for (var t = this.startTime.getTime(); t < this.endTime.getTime(); t = t + 1800000) {
      var d = new Date(t);
      var h = d.getHours();
      var ts = h >= 12 ? ' pm' : ' am';
      if (h === 0)
        h = 12;
      else if (h > 12)
        h -= 12;
      ts = h + ':' + (d.getMinutes() === 0 ? '00' : '30') + ts;
      this.timeslots.push(ts);
    }
    
    var url;
    if (this.demoMode)
      url = 'demo/guide-data/';
    else if (this.mythlingServices)
      url = '/mythling/media.php?type=guide&';
    else
      url = '/Guide/GetProgramGuide?';
    var path = 'StartTime=' + start + '&EndTime=' + end;
    if (this.channelGroupId && this.channelGroupId > 0)
      path += "&ChannelGroupId=" + this.channelGroupId;
    url += this.demoMode ? path.replace(/:/g, '-') + '.json' : path;
    if (epgDebug)
      console.log('retrieving from: ' + url);
    if (this.awaitPrime)
      angular.element(document.body).bind('touchmove', this.preventMobileScroll);
    
    // going through angular model screws up bootstrap calendar directive
    var cal = angular.element(document.getElementById('calendarInput'));
    cal.addClass('input-warn');
    cal.val('Loading...');
    $timeout(function() {
      cal.val('Loading...');
    }, 75);
    
    $http.get(url).error(function(data, status) {
      console.log(ERROR_TAG + 'HTTP ' + status + ': ' + url);
      this.busy = false;
    }).success(function(data, status, headers, config) {
      if (epgDebug)
        console.log('guide data response time: ' + config.responseTime);
      if (typeof this.isMyth28 === 'undefined') {
        this.mythVersion = data.ProgramGuide.Version ? data.ProgramGuide.Version : '0.27';
        if (epgDebug)
          console.log('MythTV version ' + this.mythVersion);
        this.isMyth28 = !this.mythVersion.startsWith('0.27');
      }
      
      var chans = data.ProgramGuide.Channels;
      
      var isFirstRetrieve = this.startTime.getTime() == this.beginTime.getTime();
      
      // insert channels missing from this retrieval (due to missing data)
      if (!isFirstRetrieve)
        this.addMissingChannelsTo(chans);
      
      var chanIdx = 0;
      for (var i = 0; i < chans.length; i++) {

        var chan = chans[i];
        // do not add channels that have no programs in the initial retrieval
        if (!isFirstRetrieve || chan.Programs.length > 0) {
          chanIdx++;
          var chanNum = this.getChanNumIndex(chan);
          
          // do not add new channels discovered when scrolling
          if (!(chanNum in this.channels) && isFirstRetrieve) {
            chan.programs = {};
            chan.progSize = 0;
            chan.progOffset = 0;
            this.channels[chanNum] = chan;
          }          
          var channel = this.channels[chanNum];
          if (typeof channel !== 'undefined' && channel !== null) {  // if new channel during scrolling
            var prevProgEnd = this.startTime;
            for (var j = 0; j < chan.Programs.length; j++) {
              var prog = chan.Programs[j];
              var startTime = prog.StartTime;
              var start = new Date(prog.StartTime);
              var end = new Date(prog.EndTime);
              // ignore programs that already ended or start after range
              if ((end.getTime() > this.startTime.getTime() - this.history) && (start.getTime() < this.endTime.getTime())) { 
                channel.programs[startTime] = prog;
  
                // don't start before begin time or end after end time
                var slotsStartTime = start.getTime() < this.beginTime.getTime() ? this.startTime.getTime() : start.getTime();
                var slotsEndTime = end.getTime() > this.endTime.getTime() ? this.endTime.getTime() : end.getTime();
                var slots = (slotsEndTime - slotsStartTime) / 1800000;
  
                // account for gaps in data
                if (slotsStartTime > prevProgEnd.getTime())
                  this.addFiller(channel, prevProgEnd, new Date(slotsStartTime));
                prevProgEnd = end;
                
                prog.start = start;
                prog.end = end;
                prog.offset = channel.progOffset;
                prog.width = Math.round(this.slotWidth * slots);
                prog.subTitle = prog.SubTitle ? '"' + prog.SubTitle + '"' : '';
                if (prog.Recording && prog.Recording.Status) {
                  var recCode = parseInt(prog.Recording.Status);
                  for (var k = 0; k < RECORD_STATUSES.length; k++) {
                    if (RECORD_STATUSES[k].code == recCode)
                      prog.recStatus = RECORD_STATUSES[k];
                  }
                }
                prog.channel = channel;
                channel.progSize++;
                prog.id = 'ch' + channel.ChanId + 'pr' + prog.StartTime;
                prog.seq = 'ch' + chanIdx + 'pr' + channel.progSize;
                prog.index = this.index++;
                channel.progOffset += prog.width;
              }
            }
            
            // account for gaps in data
            if (this.endTime.getTime() > prevProgEnd.getTime())
              this.addFiller(channel, prevProgEnd, this.endTime);
            if (isFirstRetrieve) {
              var firstProg = channel.programs[this.startTime.toISOString()];
              if (firstProg && firstProg.filler) {
                // first program is filler -- insert blank to fix guide appearance
                var blankProg = {
                  Title: '',
                  SubTitle: '',
                  channel: channel
                };
                blankProg.width = 0;
                channel.programs[this.startTime.toISOString()] = blankProg;
                channel.programs[new Date(this.startTime.getTime() + 1000).toISOString()] = firstProg;
              }
            }
          }
        }
      }
      
      if (scrollTime && scrollTime !== null) {
        var scrollTo = (scrollTime.getTime() - this.startTime.getTime()) * this.slotWidth / 1800000;
        $timeout(function() {
          $window.scrollTo(scrollTo, 0);
        }, 0);
      }

      this.startTime.setTime(this.endTime.getTime());
      this.endTime.setTime(this.endTime.getTime() + this.interval);

      if (!this.prescrolled) {
        this.prescrolled = true;
        // scroll programmatically to adjust for history
        // (also reduces initial lag on mobile browsers)
        var toScroll = (this.history * this.slotWidth) / 1800000;
        $timeout(function() {
          $window.scrollBy(toScroll, 0);
        }, 0);
      }
      
      if (programId && programId !== null) {
        $timeout(function() {
          if (epgDebug)
            console.log('selecting program: ' + programId);
          document.getElementById(programId).focus();
        }, 0);
      }
      
      if (this.awaitPrime) {
        var pms = this.preventMobileScroll;
        $timeout(function() {
          angular.element(document.body).unbind('touchmove', pms);
        }, 0);
      }
      
      cal.removeClass('input-warn');
      cal.val($filter('date')(this.curDate, 'EEE MMM d'));
      this.busy = false;
      
    }.bind(this));
  };
  
  // channel object index for proper sorting
  GuideData.prototype.getChanNumIndex = function(channel) {
    var chanNum = channel.ChanNum;
    // replace underscore or dot
    if (chanNum.indexOf('_') >= 0 || chanNum.indexOf('.') >= 0)
      chanNum = chanNum.replace(/[\._]/, '');
    else
      chanNum += '0';
    // pad to 5 digits to ensure proper sorting by chanNum
    while (chanNum.length < 5)
      chanNum = '0' + chanNum;

    // append padded chanid to accommodate duplicate channums
    var chanId = channel.ChanId;
    while (chanId.length < 5)
      chanId = '0' + chanId;

    return chanNum + '_' + chanId;
  };
  
  GuideData.prototype.addMissingChannelsTo = function(chans) {
    for (var chanNum in this.channels) {
      var found = false;
      for (var i = 0; i < chans.length; i++) {
        if (chans[i].ChanNum == this.channels[chanNum].ChanNum) {
          found = true;
          break;
        }
      }
      if (!found)
        chans.push(this.channels[chanNum]);
    }
  };
  
  GuideData.prototype.addFiller = function(channel, start, end) {
    console.log(ERROR_TAG + 'Missing Data for Channel ' + channel.ChanNum + ': ' + start + ' -> ' + end);
    var fillerStart = start.toISOString();
    channel.progSize++;
    var fillerProg = {
      filler: true,
      offset: channel.progOffset,
      Title: '',
      SubTitle: '',
      channel: channel
    };
    
    fillerProg.width = Math.round((end.getTime() - start.getTime()) * this.slotWidth / 1800000);
    channel.progOffset += fillerProg.width;
    channel.programs[fillerStart] = fillerProg;
    return fillerProg;
  };
  
  
  return GuideData;
}]);

function urlParams() {
  var params = {};
  var search = /([^&=]+)=?([^&]*)/g;
  var match;
  while ((match = search.exec(window.location.search.substring(1))) !== null)
   params[decodeURIComponent(match[1])] = decodeURIComponent(match[2]);
  return params;
}

function parseCssDim(dim) {
  if (dim.endsWith('px'))
    dim = dim.substring(0, dim.lastIndexOf('px'));
  return parseInt(dim);
}

//globals
var epgDebug;
// function for outside access from stay-omb
var setPosition;
// function for outside access from epg-device
var popHide;

// in case js string does not supply startsWith() and endsWith()
if (typeof String.prototype.startsWith != 'function') {
  String.prototype.startsWith = function(prefix) {
    return this.indexOf(prefix) === 0;
  };
}
if (typeof String.prototype.endsWith !== 'function') {
  String.prototype.endsWith = function(suffix) {
      return this.indexOf(suffix, this.length - suffix.length) !== -1;
  };
}
