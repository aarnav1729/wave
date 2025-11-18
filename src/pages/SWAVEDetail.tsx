import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import {
  getRequestByTicketNumber,
  getCurrentUser,
  saveRequest,
  addHistoryEntry,
  getHistoryByTicketNumber,
  getEmployeeById,
} from '@/lib/storage';
import { isApprover, getCurrentApprover, isFullyApproved } from '@/lib/workflow';
import { CheckCircle2, XCircle, Clock, MapPin, Users, Calendar, MessageSquare, History as HistoryIcon } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

const SWAVEDetail = () => {
  const { ticketNumber } = useParams<{ ticketNumber: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const currentUser = getCurrentUser();
  const [request, setRequest] = useState(getRequestByTicketNumber(ticketNumber || ''));
  const [comment, setComment] = useState('');
  const [declineReason, setDeclineReason] = useState('');
  const [allottedPerson, setAllottedPerson] = useState('');
  const history = getHistoryByTicketNumber(ticketNumber || '');

  useEffect(() => {
    if (!request) {
      navigate('/overview');
    }
  }, [request, navigate]);

  if (!request || !currentUser) return null;

  const canApprove = isApprover(request, currentUser.empemail);
  const currentApprover = getCurrentApprover(request);
  const fullyApproved = isFullyApproved(request);
  
  // Check if current user is final approver for plant visit
  const isFinalPlantApprover = request.typeOfLocation === 'Plant' && 
    (currentUser.empemail === 'chandra.kumar@premierenergies.com' || 
     currentUser.empemail === 'saluja@premierenergies.com') && 
    canApprove;

  const handleApprove = () => {
    const updatedApprovals = request.approvals.map(approval =>
      approval.approverEmail === currentUser.empemail
        ? { 
            ...approval, 
            status: 'approved' as const, 
            timestamp: new Date().toISOString(),
            ...(isFinalPlantApprover && allottedPerson ? { allottedPerson } : {})
          }
        : approval
    );

    const allApproved = updatedApprovals.every(a => a.status === 'approved');

    const updatedRequest = {
      ...request,
      approvals: updatedApprovals,
      status: allApproved ? ('approved' as const) : ('pending' as const),
    };

    saveRequest(updatedRequest);
    setRequest(updatedRequest);

    addHistoryEntry({
      ticketNumber: request.ticketNumber,
      userId: currentUser.empid,
      comment: comment || 'Request approved',
      actionType: 'APPROVE',
      beforeState: 'pending',
      afterState: allApproved ? 'approved' : 'pending_next_approval',
      timestamp: new Date().toISOString(),
    });

    toast({
      title: 'Request Approved',
      description: allApproved ? 'All approvals completed!' : 'Waiting for next approval',
    });

    setComment('');
    setAllottedPerson('');
  };

  const handleDecline = () => {
    if (!declineReason.trim()) {
      toast({
        title: 'Reason Required',
        description: 'Please provide a reason for declining',
        variant: 'destructive',
      });
      return;
    }

    const updatedApprovals = request.approvals.map(approval =>
      approval.approverEmail === currentUser.empemail
        ? {
            ...approval,
            status: 'declined' as const,
            timestamp: new Date().toISOString(),
            reason: declineReason,
          }
        : approval
    );

    const updatedRequest = {
      ...request,
      approvals: updatedApprovals,
      status: 'declined' as const,
    };

    saveRequest(updatedRequest);
    setRequest(updatedRequest);

    addHistoryEntry({
      ticketNumber: request.ticketNumber,
      userId: currentUser.empid,
      comment: `Request declined: ${declineReason}`,
      actionType: 'DECLINE',
      beforeState: 'pending',
      afterState: 'declined',
      timestamp: new Date().toISOString(),
    });

    toast({
      title: 'Request Declined',
      description: 'The request has been declined',
      variant: 'destructive',
    });

    setDeclineReason('');
  };

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <Card className="border-none shadow-soft bg-gradient-primary text-primary-foreground">
          <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <CardTitle className="text-2xl font-mono">{request.ticketNumber}</CardTitle>
                <CardDescription className="text-primary-foreground/80">
                  Created on {new Date(request.creationDatetime).toLocaleDateString('en-IN')}
                </CardDescription>
              </div>
              {request.status === 'approved' && (
                <Badge className="bg-success text-success-foreground">
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Approved
                </Badge>
              )}
              {request.status === 'declined' && (
                <Badge className="bg-destructive text-destructive-foreground">
                  <XCircle className="h-4 w-4 mr-1" />
                  Declined
                </Badge>
              )}
              {request.status === 'pending' && (
                <Badge className="bg-warning text-warning-foreground">
                  <Clock className="h-4 w-4 mr-1" />
                  Pending Approval
                </Badge>
              )}
            </div>
          </CardHeader>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Requester Info */}
            <Card>
              <CardHeader>
                <CardTitle>Requester Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Name:</span>
                    <p className="font-medium">{request.empDetails.empname}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Employee ID:</span>
                    <p className="font-medium">{request.empDetails.empid}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Department:</span>
                    <p className="font-medium">{request.empDetails.dept}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Location:</span>
                    <p className="font-medium">{request.empDetails.emplocation}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Visit Details */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  Visit Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div>
                    <span className="text-sm text-muted-foreground">Visitor Category:</span>
                    <p className="font-medium">{request.visitorCategory}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Purpose of Visit:</span>
                    <p className="font-medium">{request.purposeOfVisit}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm text-muted-foreground">Location Type:</span>
                      <p className="font-medium">{request.typeOfLocation}</p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Location:</span>
                      <p className="font-medium">{request.locationToVisit}</p>
                    </div>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Area to Visit:</span>
                    <p className="font-medium">{request.areaToVisit}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm text-muted-foreground">Meeting With:</span>
                      <p className="font-medium">{request.meetingWith}</p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Cell Line Visit:</span>
                      <p className="font-medium">{request.cellLineVisit ? 'Yes' : 'No'}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm text-muted-foreground">Arrival:</span>
                      <p className="font-medium">
                        {new Date(request.tentativeArrival).toLocaleString('en-IN')}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Duration:</span>
                      <p className="font-medium">{request.tentativeDuration}</p>
                    </div>
                  </div>
                  {request.lunchRequired && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <span className="text-sm text-muted-foreground">Lunch Category:</span>
                        <p className="font-medium">{request.lunchCategory}</p>
                      </div>
                      {request.dietaryRequirements && (
                        <div>
                          <span className="text-sm text-muted-foreground">Dietary Requirements:</span>
                          <p className="font-medium">{request.dietaryRequirements}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Guest Details */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Guests ({request.numberOfGuests})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {request.guests.map((guest, index) => (
                  <div key={index} className="p-4 border rounded-lg space-y-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-semibold">{guest.name}</h4>
                        <p className="text-sm text-muted-foreground">{guest.designation} at {guest.company}</p>
                      </div>
                      {fullyApproved && guest.qrCode && (
                        <div className="bg-white p-2 rounded">
                          <QRCodeSVG value={guest.qrCode} size={80} />
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Phone:</span> {guest.number}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Email:</span> {guest.email}
                      </div>
                    </div>
                    {guest.checkedIn && (
                      <div className="flex items-center gap-2 text-sm text-success">
                        <CheckCircle2 className="h-4 w-4" />
                        Checked in at {new Date(guest.checkInTime!).toLocaleTimeString('en-IN')}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Approval Actions */}
            {canApprove && request.status === 'pending' && (
              <Card className="border-primary">
                <CardHeader>
                  <CardTitle>Action Required</CardTitle>
                  <CardDescription>You are the current approver</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {isFinalPlantApprover && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Allot Person to Visit</label>
                      <Textarea
                        placeholder="Enter name of person to allot to this visit"
                        value={allottedPerson}
                        onChange={(e) => setAllottedPerson(e.target.value)}
                        rows={2}
                        className="resize-none"
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Textarea
                      placeholder="Add a comment (optional)"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      rows={3}
                    />
                  </div>
                  <Button onClick={handleApprove} className="w-full">
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Approve Request
                  </Button>
                  <Separator />
                  <div className="space-y-2">
                    <Textarea
                      placeholder="Reason for declining *"
                      value={declineReason}
                      onChange={(e) => setDeclineReason(e.target.value)}
                      rows={3}
                    />
                  </div>
                  <Button onClick={handleDecline} variant="destructive" className="w-full">
                    <XCircle className="h-4 w-4 mr-2" />
                    Decline Request
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Approval Status */}
            <Card>
              <CardHeader>
                <CardTitle>Approval Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {request.approvals.map((approval, index) => {
                  const approver = getEmployeeById(approval.approverId);
                  return (
                    <div key={index} className="flex items-start gap-3 p-3 border rounded-lg">
                      <div className="flex-shrink-0 mt-1">
                        {approval.status === 'approved' && (
                          <CheckCircle2 className="h-5 w-5 text-success" />
                        )}
                        {approval.status === 'declined' && (
                          <XCircle className="h-5 w-5 text-destructive" />
                        )}
                        {approval.status === 'pending' && (
                          <Clock className="h-5 w-5 text-warning" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{approver?.empname}</p>
                        <p className="text-xs text-muted-foreground">{approver?.designation}</p>
                        {approval.timestamp && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(approval.timestamp).toLocaleString('en-IN')}
                          </p>
                        )}
                        {approval.allottedPerson && (
                          <p className="text-xs text-primary mt-1 font-medium">
                            Allotted to: {approval.allottedPerson}
                          </p>
                        )}
                        {approval.reason && (
                          <p className="text-xs text-destructive mt-1">{approval.reason}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* History */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HistoryIcon className="h-5 w-5" />
                  History
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {history.map((entry, index) => (
                    <div key={index} className="text-sm pb-3 border-b last:border-0">
                      <p className="font-medium">{entry.actionType}</p>
                      <p className="text-muted-foreground text-xs">
                        {new Date(entry.timestamp).toLocaleString('en-IN')}
                      </p>
                      {entry.comment && (
                        <p className="text-muted-foreground mt-1">{entry.comment}</p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default SWAVEDetail;
